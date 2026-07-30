#!/usr/bin/env bash
# ONE COMMAND. Run it from anywhere:
#
#   bash ~/Developer/chalk-talk/rag/workflow-probe/run-probe.sh
#
# Written after the first attempt failed three ways, none of which were the user's fault:
#   * interactive zsh does NOT treat `#` as a comment, so a trailing "# paste id here" was passed as
#     arguments to wrangler;
#   * the cd was relative, so it failed from the home directory;
#   * `<subdomain>` in a curl example was parsed by the shell as a redirect.
# So: no inline comments on command lines, absolute paths throughout, and the URL is read from
# wrangler's own output rather than typed.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> Working in $DIR"
echo

# Wrangler walks up from the current directory looking for config and has been seen tripping over
# ~/.Trash when started from the home directory. Running from this folder avoids that.
if [ ! -f wrangler.toml ]; then
  echo "wrangler.toml not found in $DIR — is the repo checked out fully?" >&2
  exit 1
fi

# ── 1 · KV namespace, created only if the config still holds the placeholder ──
if grep -q "PASTE_THE_ID_FROM_THE_COMMAND_ABOVE" wrangler.toml; then
  echo "==> Creating the PROBE_KV namespace"
  KV_OUT="$(npx --yes wrangler kv namespace create PROBE_KV 2>&1 || true)"
  echo "$KV_OUT"

  # wrangler has printed this a few different ways across versions; take the first 32-char hex id.
  KV_ID="$(printf '%s' "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
  if [ -z "$KV_ID" ]; then
    echo >&2
    echo "Could not find a namespace id in that output." >&2
    echo "Open wrangler.toml and replace PASTE_THE_ID_FROM_THE_COMMAND_ABOVE with the id, then re-run." >&2
    exit 1
  fi
  # macOS sed needs the empty -i argument.
  sed -i '' "s/PASTE_THE_ID_FROM_THE_COMMAND_ABOVE/$KV_ID/" wrangler.toml
  echo "==> Wrote namespace id $KV_ID into wrangler.toml"
else
  echo "==> PROBE_KV already configured, skipping creation"
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
  echo "Find the URL in the Cloudflare dashboard and curl it yourself, then paste me the output." >&2
  exit 1
fi

# ── 3 · run all four probes ──────────────────────────────────────────────────
echo "==> Running the probe at $URL"
echo "    (four workflow instances, about 30-60 seconds; no paid API is called)"
echo
curl -sS --max-time 300 "$URL/"
echo
echo
echo "==> Done. Paste the block above back to me."
echo "==> To clean up afterwards:"
echo "      cd \"$DIR\" && npx wrangler delete"
