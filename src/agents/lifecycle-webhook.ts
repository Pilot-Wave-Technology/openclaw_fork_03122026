/**
 * Agent lifecycle webhook — notifies the control panel when CLI agents
 * start, complete, fail, or time out.
 *
 * Events are fire-and-forget (non-blocking). If the control panel is
 * unreachable, events are logged and dropped.
 *
 * Environment:
 *   CONTROL_PANEL_URL — base URL of the control panel
 *   OPENCLAW_GATEWAY_TOKEN — bearer token for auth
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("lifecycle-webhook");

interface LifecycleEvent {
  event: "agent.started" | "agent.completed" | "agent.failed" | "agent.timeout";
  session_key: string;
  agent_id: string;
  run_id: string;
  provider: string;
  model: string;
  timestamp: string;
  duration_ms?: number;
  exit_code?: number;
  error?: string;
  reason?: string;
}

const WEBHOOK_TIMEOUT_MS = 5000;

export function fireLifecycleWebhook(event: LifecycleEvent): void {
  const url = process.env.CONTROL_PANEL_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!url || !token) return;

  const endpoint = `${url.replace(/\/$/, "")}/internal/agents/lifecycle`;

  // Fire and forget — don't await, don't block the agent
  fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        log.warn(`lifecycle webhook ${event.event} returned ${res.status}`);
      }
    })
    .catch((err) => {
      log.debug(`lifecycle webhook ${event.event} failed: ${err}`);
    });
}
