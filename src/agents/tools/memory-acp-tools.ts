/**
 * ACP Memory Tools — PostgreSQL-backed replacements for memory_search, memory_get, memory_save.
 *
 * These tools make HTTP calls to the control panel internal API instead of querying
 * local SQLite. Same tool names as built-in — agents use them without any instructions.
 *
 * Only used for ACP-managed agents (SHCA). Non-ACP agents keep the file-based tools.
 */
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

import * as fs from "node:fs";
import * as path from "node:path";

function logMemoryToolError(tool: string, msg: string, detail?: unknown): void {
  console.error(`[ACP Memory] ${tool}: ${msg}`, detail ?? "");
}

function logMemoryToolInfo(tool: string, msg: string): void {
  console.log(`[ACP Memory] ${tool}: ${msg}`);
}

/** Cached ACP config — read once from workspace on first tool call. */
let _acpConfigCache: Record<string, string> | null | undefined = undefined;

function loadAcpConfig(workspaceDir?: string): Record<string, string> | null {
  if (_acpConfigCache !== undefined) return _acpConfigCache;

  // Try workspace dir first, then common locations
  const candidates: string[] = [];
  if (workspaceDir) candidates.push(path.join(workspaceDir, "ACP_CONFIG.json"));

  // Also check process.cwd() (agent workspace is usually cwd)
  candidates.push(path.join(process.cwd(), "ACP_CONFIG.json"));

  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      _acpConfigCache = JSON.parse(raw);
      logMemoryToolInfo("config", `Loaded ACP_CONFIG.json from ${p}`);
      return _acpConfigCache;
    } catch {
      // File not found or invalid — try next
    }
  }

  _acpConfigCache = null;
  return null;
}

/** Check if this agent is ACP-managed by looking for ACP_CONFIG.json */
export function isAcpManaged(workspaceDir?: string): boolean {
  return loadAcpConfig(workspaceDir) !== null;
}

function getControlPanelUrl(): string {
  const cfg = loadAcpConfig();
  return (
    cfg?.control_panel_url ||
    process.env.CONTROL_PANEL_URL ||
    process.env.OPENCLAW_CONTROL_PANEL_URL ||
    ""
  ).replace(/\/$/, "");
}

function getAuthToken(): string {
  return process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

function getGoalId(): string {
  return loadAcpConfig()?.goal_id || process.env.PWT_GOAL_ID || "";
}

function getThreadId(): string {
  return loadAcpConfig()?.thread_id || process.env.PWT_THREAD_ID || "";
}

function getAgentTemplateId(): string {
  return loadAcpConfig()?.agent_template_id || "";
}

// ── memory_search ───────────────────────────────────────────────────────────

const AcpMemorySearchSchema = Type.Object({
  query: Type.String({
    description: "What to search for in your project memory.",
  }),
  scope: Type.Optional(
    Type.String({
      description:
        'Search scope: "all" (default, current goal + global), "goal", "conversation", "cross_goal" (all goals you work on).',
    }),
  ),
  type: Type.Optional(
    Type.String({
      description:
        'Filter by type: "decision", "task_outcome", "blocker", "preference", "observation", "context".',
    }),
  ),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum results to return (default 10).",
    }),
  ),
});

export function createAcpMemorySearchTool(opts?: {
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Search your project memory — decisions, task outcomes, blockers, " +
      "preferences, and context across all your goals. " +
      "Use before making decisions or when you need context about past work.",
    parameters: AcpMemorySearchSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const scope = readStringParam(params, "scope") || "all";
      const type = readStringParam(params, "type") || "";
      const maxResults = readNumberParam(params, "max_results") || 10;

      const baseUrl = getControlPanelUrl();
      const token = getAuthToken();
      const agentId = opts?.agentId || "";

      if (!baseUrl || !token || !agentId) {
        logMemoryToolError("memory_search", "Not configured", { baseUrl: !!baseUrl, token: !!token, agentId });
        return jsonResult({
          results: [],
          error: "ACP memory not configured (missing CONTROL_PANEL_URL, token, or agent ID).",
        });
      }

      const searchParams = new URLSearchParams({
        q: query,
        goal_id: getGoalId(),
        thread_id: getThreadId(),
        scope,
        max_results: String(maxResults),
      });
      if (type) searchParams.set("type", type);

      const url = `${baseUrl}/internal/memory/${encodeURIComponent(agentId)}/search?${searchParams}`;
      logMemoryToolInfo("memory_search", `query="${query}" scope=${scope} goal=${getGoalId()}`);

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "unknown error");
          logMemoryToolError("memory_search", `HTTP ${res.status}`, errText);
          return jsonResult({ results: [], error: `Search failed (${res.status}): ${errText}` });
        }

        const data = (await res.json()) as {
          results: Array<Record<string, unknown>>;
          count: number;
        };

        logMemoryToolInfo("memory_search", `${data.results?.length ?? 0} results for "${query}"`);

        // Format results as readable text for the agent
        if (!data.results || data.results.length === 0) {
          return jsonResult({ results: [], message: `No results found for "${query}".` });
        }

        const lines: string[] = [`Found ${data.results.length} results:\n`];
        for (const r of data.results) {
          lines.push(`[${r.type}] ${r.title}`);
          if (r.human) lines.push(`  By: ${r.human}${r.agent ? ` (via ${r.agent})` : ""}`);
          else if (r.agent) lines.push(`  By: ${r.agent}`);
          if (r.goal) lines.push(`  Goal: ${r.goal}`);
          if (r.date) lines.push(`  Date: ${String(r.date).slice(0, 10)}`);
          if (r.content) lines.push(`  ${String(r.content).slice(0, 300)}`);
          if (r.files && (r.files as string[]).length > 0)
            lines.push(`  Files: ${(r.files as string[]).join(", ")}`);
          lines.push(`  ID: ${r.id} | Source: ${r.source}`);
          lines.push("");
        }

        return jsonResult({ text: lines.join("\n"), count: data.results.length });
      } catch (err) {
        logMemoryToolError("memory_search", "Request failed", err);
        return jsonResult({ results: [], error: `Memory search failed: ${String(err)}` });
      }
    },
  };
}

// ── memory_get ──────────────────────────────────────────────────────────────

const AcpMemoryGetSchema = Type.Object({
  id: Type.String({
    description: "The ID of the item from memory_search results.",
  }),
});

export function createAcpMemoryGetTool(opts?: {
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Get full details on any item from memory_search results — " +
      "task history, messages, file changes, and who was involved.",
    parameters: AcpMemoryGetSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const itemId = readStringParam(params, "id", { required: true, trim: true });

      const baseUrl = getControlPanelUrl();
      const token = getAuthToken();
      const agentId = opts?.agentId || "";

      if (!baseUrl || !token || !agentId) {
        logMemoryToolError("memory_get", "Not configured");
        return jsonResult({ error: "ACP memory not configured." });
      }

      const url = `${baseUrl}/internal/memory/${encodeURIComponent(agentId)}/detail/${encodeURIComponent(itemId)}`;
      logMemoryToolInfo("memory_get", `id=${itemId}`);

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "unknown error");
          logMemoryToolError("memory_get", `HTTP ${res.status}`, errText);
          return jsonResult({ error: `Detail fetch failed (${res.status}): ${errText}` });
        }

        const data = await res.json();
        logMemoryToolInfo("memory_get", `Retrieved detail for ${itemId} (source: ${data.source})`);
        return jsonResult(data);
      } catch (err) {
        logMemoryToolError("memory_get", "Request failed", err);
        return jsonResult({ error: `Memory detail failed: ${String(err)}` });
      }
    },
  };
}

// ── memory_save ─────────────────────────────────────────────────────────────

const AcpMemorySaveSchema = Type.Object({
  title: Type.String({
    description: "Short label for this memory (max ~10 words).",
  }),
  content: Type.String({
    description: "Full detail of what to remember.",
  }),
  type: Type.String({
    description:
      'Memory type: "preference" (user preference), "observation" (codebase/process insight), ' +
      '"context" (working context), "convention" (project convention).',
  }),
  scope: Type.Optional(
    Type.String({
      description:
        '"global" (applies across all goals), "goal" (this goal only, default), "conversation" (this chat only).',
    }),
  ),
  files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Related file paths.",
    }),
  ),
});

export function createAcpMemorySaveTool(opts?: {
  agentId?: string;
}): AnyAgentTool {
  return {
    label: "Memory Save",
    name: "memory_save",
    description:
      "Save an important observation, preference, or context to your memory. " +
      "Persists across conversations. Use 'global' scope for knowledge that applies to all goals, " +
      "'goal' for this goal specifically, 'conversation' for temporary working context.",
    parameters: AcpMemorySaveSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const title = readStringParam(params, "title", { required: true });
      const content = readStringParam(params, "content", { required: true });
      const type = readStringParam(params, "type", { required: true });
      const scope = readStringParam(params, "scope") || "goal";
      const files = (params.files as string[] | undefined) || [];

      const baseUrl = getControlPanelUrl();
      const token = getAuthToken();
      const agentId = opts?.agentId || "";

      if (!baseUrl || !token || !agentId) {
        logMemoryToolError("memory_save", "Not configured");
        return jsonResult({ success: false, error: "ACP memory not configured." });
      }

      const url = `${baseUrl}/internal/memory/${encodeURIComponent(agentId)}`;
      logMemoryToolInfo("memory_save", `title="${title}" type=${type} scope=${scope}`);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            content,
            type,
            scope,
            goal_id: getGoalId(),
            thread_id: getThreadId(),
            files,
          }),
          signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "unknown error");
          logMemoryToolError("memory_save", `HTTP ${res.status}`, errText);
          return jsonResult({ success: false, error: `Save failed (${res.status}): ${errText}` });
        }

        const data = await res.json();
        logMemoryToolInfo("memory_save", `Saved: id=${data.id} title="${title}"`);
        return jsonResult({
          success: true,
          id: data.id,
          message: `Memory saved: "${title}" (scope: ${scope})`,
        });
      } catch (err) {
        logMemoryToolError("memory_save", "Request failed", err);
        return jsonResult({ success: false, error: `Memory save failed: ${String(err)}` });
      }
    },
  };
}
