/**
 * task_report tool — allows agents to report task completion, failure, or questions
 * to the multi-agent control panel.
 *
 * This enables the task controller to detect when an agent finishes work,
 * parse planner subtasks, and advance the task DAG — without polling.
 */
import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const TaskReportSchema = Type.Object({
  task_id: Type.String({
    description: "The task ID assigned to this agent. Provided in the dispatch message.",
  }),
  status: stringEnum(["completed", "failed", "blocked"], {
    description:
      "Task status: 'completed' = work done, 'failed' = unrecoverable error, 'blocked' = need human input.",
  }),
  result: Type.String({
    description:
      "Summary of what was done (completed), the error (failed), or the question (blocked). Include branch name, files changed, and any subtask JSON if you are a planner agent.",
  }),
  metadata: Type.Optional(
    Type.Object(
      {
        branch: Type.Optional(Type.String({ description: "Git branch name" })),
        files_changed: Type.Optional(Type.Array(Type.String(), { description: "List of files created or modified" })),
      },
      { additionalProperties: true, description: "Optional structured metadata." },
    ),
  ),
});

export function createTaskReportTool(opts?: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Task Report",
    name: "pwt_task_report",
    description:
      "Report task completion, failure, or a question to the control panel. " +
      "Call this when you finish your task, encounter an unrecoverable error, or need human input. " +
      "The task controller will process your report and advance the task pipeline.",
    parameters: TaskReportSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "task_id", { required: true, trim: true });
      const status = readStringParam(params, "status", { required: true, trim: true });
      const result = readStringParam(params, "result", { required: true });
      const metadata = params.metadata ?? {};

      // Resolve control panel URL and auth token
      const controlPanelUrl =
        process.env.CONTROL_PANEL_URL || process.env.OPENCLAW_CONTROL_PANEL_URL || "";
      const token = process.env.OPENCLAW_GATEWAY_TOKEN || "";

      if (!controlPanelUrl) {
        return jsonResult({
          success: false,
          error: "CONTROL_PANEL_URL environment variable not set. Cannot report task.",
        });
      }

      if (!token) {
        return jsonResult({
          success: false,
          error: "OPENCLAW_GATEWAY_TOKEN not set. Cannot authenticate with control panel.",
        });
      }

      const url = `${controlPanelUrl.replace(/\/$/, "")}/internal/tasks/${encodeURIComponent(taskId)}/complete`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status, result, metadata }),
          signal,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "unknown error");
          return jsonResult({
            success: false,
            error: `Control panel returned ${res.status}: ${errorText}`,
          });
        }

        const payload = await res.json().catch(() => ({}));
        return jsonResult({
          success: true,
          task_id: taskId,
          status,
          message: "Task report submitted successfully.",
          ...payload,
        });
      } catch (err) {
        return jsonResult({
          success: false,
          error: `Failed to submit task report: ${String(err)}`,
        });
      }
    },
  };
}
