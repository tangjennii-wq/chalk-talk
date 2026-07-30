#!/usr/bin/env bash
# ONE COMMAND. Run from anywhere:
#
#   bash ~/Developer/chalk-talk/rag/workflow-probe/run-probe.sh
#
# Deploys a throwaway Worker, runs four probes, prints a verdict. No paid API. Does not touch Chalk Talk.
#
# Design notes, both earned the hard way:
#   * No inline `#` comments on command lines — interactive zsh does not treat them as comments.
#   * The Worker STARTS the instances and returns immediately; this script does the waiting. The first
#     version polled inside the request, held it open for minutes, and died with Cloudflare error 1104.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> Working in $DIR"
echo

if [ ! -f wrangler.toml ]; then
  echo "wrangler.toml not found in $DIR" >&2
  exit 1
fi

# ── 1 · KV namespace, only if still a placeholder ────────────────────────────
if grep -q "PASTE_THE_ID_FROM_THE_COMMAND_ABOVE" wrangler.toml; then
  echo "==> Creating the PROBE_KV namespace"
  KV_OUT="$(npx --yes wrangler kv namespace create PROBE_KV 2>&1 || true)"
  echo "$KV_OUT"
  KV_ID="$(printf '%s' "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
  if [ -z "$KV_ID" ]; then
    echo >&2
    echo "No namespace id found in that output. Put it into wrangler.toml by hand and re-run." >&2
    exit 1
  fi
  sed -i '' "s/PASTE_THE_ID_FROM_THE_COMMAND_ABOVE/$KV_ID/" wrangler.toml
  echo "==> Wrote namespace id $KV_ID into wrangler.toml"
else
  echo "==> PROBE_KV already configured"
fi
echo

# ── 2 · deploy ───────────────────────────────────────────────────────────────
echo "==> Deploying the probe Worker"
DEPLOY_OUT="$(npx --yes wrangler deploy 2>&1)"
echo "$DEPLOY_OUT"
echo

URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]*workers\.dev' | head -1 || true)"
if [ -z "$URL" ]; then
  echo "Deploy finished but no workers.dev URL was printed." >&2
  exit 1
fi

# ── 3 · start, then poll from HERE rather than inside the Worker ─────────────
echo "==> Clearing any previous run"
curl -sS --max-time 30 "$URL/reset" >/dev/null || true

echo "==> Starting four workflow instances"
curl -sS --max-time 30 "$URL/" || true
echo

echo "==> Waiting for them to finish (checking every 10s, up to 4 minutes)"
RESULT=""
for i in $(seq 1 24); do
  sleep 10
  RESULT="$(curl -sS --max-time 30 "$URL/" || true)"
  if printf '%s' "$RESULT" | grep -q "RUNTIME PROBE"; then
    break
  fi
  printf '    [%s] %s\n' "$((i * 10))s" "$(printf '%s' "$RESULT" | head -1)"
done

echo
echo "────────────────────────────────────────────────────────────────────────"
printf '%s\n' "$RESULT"
echo "────────────────────────────────────────────────────────────────────────"
echo
if ! printf '%s' "$RESULT" | grep -q "RUNTIME PROBE"; then
  echo "Did not reach a verdict in 4 minutes. Paste the above anyway — the partial"
  echo "statuses are still informative."
fi
echo "==> Paste the block above back to Claude."
echo
echo "==> Cleanup, when you are done:"
echo "      cd \"$DIR\""
echo "      npx wrangler delete"
