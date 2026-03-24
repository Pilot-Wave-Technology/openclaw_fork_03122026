/**
 * Task management tools for SHCA agents.
 *
 * pwt_create_task — create a task via the control panel
 * pwt_task_status — get the task DAG for a goal
 * pwt_task_activity — get activity log for a specific task
 */
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

// ── pwt_create_task ─────────────────────────────────────────────────────────

const CreateTaskSchema = Type.Object({
  goal_id: Type.String({ description: "The goal ID to create the task in." }),
  title: Type.String({ description: "Clear, specific task title." }),
  description: Type.String({
    description:
      "Full task specification including: goal, repository, language/framework, functional requirements, error handling, testing requirements, and definition of done.",
  }),
});

export function createTaskTool(opts?: {
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Create Task",
    name: "pwt_create_task",
    description:
      "Create a new task in the control panel. The task controller will automatically " +
      "send it to the Planner agent, which creates subtasks and dispatches them to coding agents. " +
      "Only call this AFTER the user has approved the task specification.",
    parameters: CreateTaskSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const goalId = readStringParam(params, "goal_id", { required: true, trim: true });
      const title = readStringParam(params, "title", { required: true, trim: true });
      const description = readStringParam(params, "description", { required: true });

      const url = process.env.CONTROL_PANEL_URL || "";
      const token = process.env.OPENCLAW_GATEWAY_TOKEN || "";

      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set" });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set" });

      try {
        const res = await fetch(
          `${url.replace(/\/$/, "")}/internal/goals/${encodeURIComponent(goalId)}/task-spec`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, description }),
            signal,
          },
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "unknown");
          return jsonResult({ success: false, error: `HTTP ${res.status}: ${err}` });
        }

        const data = await res.json().catch(() => ({}));
        return jsonResult({
          success: true,
          task_id: data.task_id,
          message: `Task created: ${data.task_id}. The planner will analyze and create subtasks automatically.`,
        });
      } catch (err) {
        return jsonResult({ success: false, error: String(err) });
      }
    },
  };
}

// ── pwt_task_status ─────────────────────────────────────────────────────────

const TaskStatusSchema = Type.Object({
  goal_id: Type.String({ description: "The goal ID to get tasks for." }),
});

export function createTaskStatusTool(opts?: {
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Task Status",
    name: "pwt_task_status",
    description:
      "Get the full task DAG for a goal — all tasks with states, subtasks, dependencies, and results. " +
      "Use this to check progress and report status to the user.",
    parameters: TaskStatusSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const goalId = readStringParam(params, "goal_id", { required: true, trim: true });

      const url = process.env.CONTROL_PANEL_URL || "";
      const token = process.env.OPENCLAW_GATEWAY_TOKEN || "";

      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set" });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set" });

      try {
        const res = await fetch(
          `${url.replace(/\/$/, "")}/internal/goals/${encodeURIComponent(goalId)}/task-dag`,
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

// ── pwt_task_activity ───────────────────────────────────────────────────────

const TaskActivitySchema = Type.Object({
  goal_id: Type.String({ description: "The goal ID." }),
  task_id: Type.String({ description: "The task ID to get activity for." }),
});

export function createTaskActivityTool(opts?: {
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Task Activity",
    name: "pwt_task_activity",
    description:
      "Get the activity log for a specific task — dispatches, completions, questions, errors. " +
      "Use this to understand what an agent did and what happened during execution.",
    parameters: TaskActivitySchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const goalId = readStringParam(params, "goal_id", { required: true, trim: true });
      const taskId = readStringParam(params, "task_id", { required: true, trim: true });

      const url = process.env.CONTROL_PANEL_URL || "";
      const token = process.env.OPENCLAW_GATEWAY_TOKEN || "";

      if (!url) return jsonResult({ success: false, error: "CONTROL_PANEL_URL not set" });
      if (!token) return jsonResult({ success: false, error: "OPENCLAW_GATEWAY_TOKEN not set" });

      try {
        const res = await fetch(
          `${url.replace(/\/$/, "")}/internal/goals/${encodeURIComponent(goalId)}/task-activity/${encodeURIComponent(taskId)}`,
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
