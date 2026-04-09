/**
 * Story tools for SHCA and GO agents.
 *
 * pwt_story_list   — list all stories in the goal
 * pwt_story_detail — get full story context
 * pwt_story_update — post a progress update (Gemini-merged)
 */
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

function getControlPanelConfig() {
  const url = process.env.CONTROL_PANEL_URL || "";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || "";
  return { url: url.replace(/\/$/, ""), token };
}

function resolveGoalIdFromSession(sessionKey?: string): string {
  if (!sessionKey) return "";
  // Session key format: agent:{agentId}:{goalId}-{threadId}
  const parts = sessionKey.split(":");
  if (parts.length >= 3) {
    const goalThread = parts.slice(2).join(":");
    const dashIdx = goalThread.indexOf("-");
    return dashIdx > 0 ? goalThread.substring(0, dashIdx) : goalThread;
  }
  return "";
}

// ── pwt_story_list ──────────────────────────────────────────────────────────

const StoryListSchema = Type.Object({});

export function storyListTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "List Stories",
    name: "pwt_story_list",
    description:
      "List all stories in the current goal with their states, task progress, " +
      "and a preview of the progress summary.",
    parameters: StoryListSchema,
    execute: async (_toolCallId, _args, _signal) => {
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id." });
      }
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });

      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        }
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}

// ── pwt_story_detail ────────────────────────────────────────────────────────

const StoryDetailSchema = Type.Object({
  story_id: Type.String({ description: "The story ID to get details for." }),
});

export function storyDetailTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Story Detail",
    name: "pwt_story_detail",
    description:
      "Get full details of a specific story including description, acceptance criteria, " +
      "tasks under it, dependencies, and the full progress summary.",
    parameters: StoryDetailSchema,
    execute: async (_toolCallId, args, _signal) => {
      const params = args as Record<string, unknown>;
      const storyId = readStringParam(params, "story_id", { required: true, trim: true });
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id." });
      }
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });

      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories/${encodeURIComponent(storyId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        }
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}

// ── pwt_story_update ────────────────────────────────────────────────────────

const StoryUpdateSchema = Type.Object({
  story_id: Type.String({ description: "The story ID to update." }),
  update: Type.String({
    description:
      "A detailed progress update. Describe what was done, key decisions made, " +
      "approach changes, blockers resolved, or resources created/modified. " +
      "This will be merged with the existing progress summary using AI summarization.",
  }),
});

export function storyUpdateTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Update Story Progress",
    name: "pwt_story_update",
    description:
      "Post a progress update to a story. The update is merged with the existing " +
      "progress summary using AI summarization, keeping it concise and current. " +
      "Use this when something noteworthy happens: task completed, approach decided, " +
      "blocker hit or resolved, deviation from plan.",
    parameters: StoryUpdateSchema,
    execute: async (_toolCallId, args, _signal) => {
      const params = args as Record<string, unknown>;
      const storyId = readStringParam(params, "story_id", { required: true, trim: true });
      const update = readStringParam(params, "update", { required: true });
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id." });
      }
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });

      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories/${encodeURIComponent(storyId)}/update`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ update }),
          },
        );
        if (!res.ok) {
          return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        }
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}

// ── pwt_create_story ────────────────────────────────────────────────────────

const CreateStorySchema = Type.Object({
  title: Type.String({ description: "Clear story title describing the work item." }),
  description: Type.Optional(Type.String({ description: "Detailed description of what needs to be done." })),
  acceptance_criteria: Type.Optional(Type.String({ description: "How we know this story is done." })),
  assigned_to: Type.Optional(Type.String({ description: "Human uid to assign to." })),
  priority: Type.Optional(Type.String({ description: "low, medium, high, or critical." })),
  depends_on: Type.Optional(Type.Array(Type.String(), { description: "Story IDs or titles this depends on." })),
  estimated_effort: Type.Optional(Type.String({ description: "e.g. '2 days', '1 week'" })),
});

export function storyCreateTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Create Story",
    name: "pwt_create_story",
    description:
      "Create a new story on the Story Board. Stories are human-level work items. " +
      "Only create stories after the team has approved your plan. " +
      "The story appears as 'proposed' and the assigned human must accept it.",
    parameters: CreateStorySchema,
    execute: async (_toolCallId: string, args: unknown, _signal: unknown) => {
      const params = args as Record<string, unknown>;
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) return jsonResult({ success: false, error: "Could not determine goal_id." });
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories/create`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(params),
          },
        );
        if (!res.ok) return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}

// ── pwt_update_story ────────────────────────────────────────────────────────

const UpdateStorySchema = Type.Object({
  story_id: Type.String({ description: "The story ID to update." }),
  description: Type.Optional(Type.String({ description: "New description." })),
  acceptance_criteria: Type.Optional(Type.String({ description: "New acceptance criteria." })),
  priority: Type.Optional(Type.String({ description: "New priority." })),
  assigned_to: Type.Optional(Type.String({ description: "New assignee uid." })),
  depends_on: Type.Optional(Type.Array(Type.String(), { description: "New dependency list." })),
  estimated_effort: Type.Optional(Type.String({ description: "New effort estimate." })),
});

export function storyModifyTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Update Story",
    name: "pwt_update_story",
    description: "Update a story's description, acceptance criteria, priority, assignee, dependencies, or effort estimate.",
    parameters: UpdateStorySchema,
    execute: async (_toolCallId: string, args: unknown, _signal: unknown) => {
      const params = args as Record<string, unknown>;
      const storyId = readStringParam(params, "story_id", { required: true, trim: true });
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) return jsonResult({ success: false, error: "Could not determine goal_id." });
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories/${encodeURIComponent(storyId)}/modify`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(params),
          },
        );
        if (!res.ok) return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}

// ── pwt_cancel_story ────────────────────────────────────────────────────────

const CancelStorySchema = Type.Object({
  story_id: Type.String({ description: "The story ID to cancel." }),
  reason: Type.String({ description: "Why this story is being cancelled." }),
});

export function storyCancelTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Cancel Story",
    name: "pwt_cancel_story",
    description: "Cancel a story. The assignee is notified. Only cancel after team approval.",
    parameters: CancelStorySchema,
    execute: async (_toolCallId: string, args: unknown, _signal: unknown) => {
      const params = args as Record<string, unknown>;
      const storyId = readStringParam(params, "story_id", { required: true, trim: true });
      const reason = readStringParam(params, "reason", { required: true });
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) return jsonResult({ success: false, error: "Could not determine goal_id." });
      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/stories/${encodeURIComponent(storyId)}/cancel`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          },
        );
        if (!res.ok) return jsonResult({ success: false, error: `HTTP ${res.status}`, body: await res.text() });
        return jsonResult(await res.json());
      } catch (e: any) {
        return jsonResult({ success: false, error: e.message });
      }
    },
  };
}
