/**
 * Task management tools for SHCA (Project Manager) agents.
 *
 * pwt_create_task — create a task with full spec, auto-dispatched to planner
 * pwt_task_status — get all tasks and their states for the goal
 * pwt_task_activity — get detailed activity log for a specific task
 *
 * These tools call the control panel's internal API.
 * Requires CONTROL_PANEL_URL and OPENCLAW_GATEWAY_TOKEN in env.
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

// ── pwt_create_task ─────────────────────────────────────────────────────────

const CreateTaskSchema = Type.Object({
  title: Type.String({
    description: "Clear, specific task title.",
  }),
  description: Type.String({
    description:
      "Full task specification including: objective, repository, language/framework, " +
      "functional requirements, error handling, testing requirements, and definition of done. " +
      "This is what the Planner agent reads to create the implementation plan.",
  }),
  source_thread_id: Type.Optional(Type.String({
    description:
      "The conversation thread ID where this task was requested. " +
      "Agent questions and status updates will be posted back to this thread.",
  })),
});

export function createTaskTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Create Task",
    name: "pwt_create_task",
    description:
      "Create a new task. The task controller automatically sends it to the Planner agent, " +
      "which creates a CLAUDE.md and subtask plan, then dispatches subtasks to coding agents. " +
      "Only call this AFTER the user has approved the task specification. " +
      "Include the full approved spec in the description field.",
    parameters: CreateTaskSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const title = readStringParam(params, "title", { required: true, trim: true });
      const description = readStringParam(params, "description", { required: true });
      const sourceThreadId = readStringParam(params, "source_thread_id") || "";

      // Resolve goal_id from session key: agent:{agentId}:{goalId}-{threadId}
      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id from session context." });
      }

      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set." });

      try {
        const body: Record<string, string> = { title, description };
        // Always prefer thread ID from session key — the agent's own
        // "conversation ID" is the gateway's internal timestamp, not the
        // control panel's thread UUID.
        const sessionKeyThreadId = resolveThreadIdFromSession(opts?.agentSessionKey);
        if (sessionKeyThreadId) body.source_thread_id = sessionKeyThreadId;
        else if (sourceThreadId) body.source_thread_id = sourceThreadId;
        const gwAgentId = resolveAgentIdFromSession(opts?.agentSessionKey);
        if (gwAgentId) body.gateway_agent_id = gwAgentId;

        const res = await fetch(`${url}/internal/goals/${encodeURIComponent(goalId)}/task-spec`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "unknown");
          return jsonResult({ success: false, error: `HTTP ${res.status}: ${err}` });
        }

        const data = await res.json().catch(() => ({}));
        return jsonResult({
          success: true,
          task_id: data.task_id,
          message: `Task created: ${data.task_id}. The planner will create a plan and dispatch subtasks automatically.`,
        });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  };
}

// ── pwt_task_status ─────────────────────────────────────────────────────────

const TaskStatusSchema = Type.Object({
  task_id: Type.Optional(Type.String({
    description: "Optional: specific task ID to check. If omitted, returns all tasks in the goal.",
  })),
});

export function createTaskStatusTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Task Status",
    name: "pwt_task_status",
    description:
      "Get task status. Returns all tasks with their states, subtasks, dependencies, and results. " +
      "Use this to check progress and report to the user.",
    parameters: TaskStatusSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "task_id") || "";

      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id from session context." });
      }

      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set." });

      try {
        const res = await fetch(`${url}/internal/goals/${encodeURIComponent(goalId)}/task-dag`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "unknown");
          return jsonResult({ success: false, error: `HTTP ${res.status}: ${err}` });
        }

        const data = await res.json().catch(() => ({}));

        // If a specific task_id was requested, filter to just that task + subtasks
        if (taskId && Array.isArray(data.tasks)) {
          data.tasks = data.tasks.filter(
            (t: Record<string, unknown>) => t.id === taskId || t.parent_task_id === taskId,
          );
        }

        return jsonResult(data);
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  };
}

// ── pwt_task_activity ───────────────────────────────────────────────────────

const TaskActivitySchema = Type.Object({
  task_id: Type.String({
    description: "The task ID to get activity for.",
  }),
});

export function createTaskActivityTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Task Activity",
    name: "pwt_task_activity",
    description:
      "Get the activity log for a specific task — dispatches, completions, questions, errors, and structured reports. " +
      "Use this to see what an agent did and what happened during execution.",
    parameters: TaskActivitySchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "task_id", { required: true, trim: true });

      const goalId = opts?.goalId || resolveGoalIdFromSession(opts?.agentSessionKey) || "";
      if (!goalId) {
        return jsonResult({ success: false, error: "Could not determine goal_id from session context." });
      }

      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set." });

      try {
        const res = await fetch(
          `${url}/internal/goals/${encodeURIComponent(goalId)}/task-activity/${encodeURIComponent(taskId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          },
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "unknown");
          return jsonResult({ success: false, error: `HTTP ${res.status}: ${err}` });
        }

        const data = await res.json().catch(() => ({}));
        return jsonResult(data);
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  };
}

// ── pwt_message_shca ────────────────────────────────────────────────────────

const MessageShcaSchema = Type.Object({
  task_id: Type.String({
    description: "Your assigned task ID.",
  }),
  content: Type.String({
    description: "Message content to send to the project manager.",
  }),
  type: Type.Optional(Type.String({
    description: "Message type: 'progress' for status updates, 'question' for clarifications, 'fyi' for informational. Defaults to 'progress'.",
  })),
});

export function createMessageShcaTool(opts?: {
  config?: OpenClawConfig;
  goalId?: string;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Message SHCA",
    name: "pwt_message_shca",
    description:
      "Send a message to the project manager (SHCA) without blocking your task. " +
      "Use for progress updates, clarification questions, or FYI messages. " +
      "This does NOT pause your work — continue after sending.",
    parameters: MessageShcaSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "task_id", { required: true, trim: true });
      const content = readStringParam(params, "content", { required: true });
      const msgType = readStringParam(params, "type") || "progress";

      const { url, token } = getControlPanelConfig();
      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set." });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set." });

      const gwAgentId = resolveAgentIdFromSession(opts?.agentSessionKey);

      try {
        const res = await fetch(
          `${url}/internal/tasks/${encodeURIComponent(taskId)}/message-shca`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content, type: msgType, gateway_agent_id: gwAgentId }),
            signal,
          },
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "unknown");
          return jsonResult({ success: false, error: `HTTP ${res.status}: ${err}` });
        }

        return jsonResult({ success: true, message: "Message sent to SHCA." });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  };
}

// ── Helper ──────────────────────────────────────────────────────────────────

function resolveGoalIdFromSession(sessionKey?: string): string {
  // Session key format: agent:{agentId}:{goalId}-{threadId}
  if (!sessionKey) return "";
  const parts = sessionKey.split(":");
  if (parts.length < 3) return "";
  const rest = parts.slice(2).join(":");
  const dashIndex = rest.indexOf("-");
  return dashIndex > 0 ? rest.substring(0, dashIndex) : rest;
}

function resolveThreadIdFromSession(sessionKey?: string): string {
  // Session key format: agent:{agentId}:{goalId}-{threadId}
  // The control panel sets this as: agent:abhishek-shca:2ddca454-f0460f94-a20e-...
  // But the gateway may assign its own session key with a timestamp instead.
  // Returns whatever is after the first dash in the last segment.
  if (!sessionKey) return "";
  const parts = sessionKey.split(":");
  if (parts.length < 3) return "";
  const rest = parts.slice(2).join(":");
  const dashIndex = rest.indexOf("-");
  if (dashIndex <= 0) return "";
  return rest.substring(dashIndex + 1);
}

function resolveAgentIdFromSession(sessionKey?: string): string {
  // Session key format: agent:{agentId}:{goalId}-{threadId}
  if (!sessionKey) return "";
  const parts = sessionKey.split(":");
  return parts.length >= 2 ? parts[1] : "";
}
