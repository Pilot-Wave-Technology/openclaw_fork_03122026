#!/bin/bash
set -e

export GEMINI_API_KEY=$(gcloud secrets versions access latest --secret=gemini-api-key --project=agentic-team-490106)
export OPENCLAW_GATEWAY_TOKEN=45e5ec372cef02fb5ba8674f12caba53b0d553f74913c5d05ce3f98b41dff3b9

cd ~/openclaw_fork_03122026

# Pull latest changes, install deps, and rebuild
git pull origin openclaw-build
pnpm install --frozen-lockfile
pnpm build

# Start the gateway
node openclaw.mjs gateway
