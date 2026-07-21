#!/usr/bin/env bash
# Add or update ONE key in .env — it asks you to paste the value, you just paste + Enter.
#
# Usage:
#   bash rag/addkey.sh                  -> asks which key, then asks for the value
#   bash rag/addkey.sh OPENAI_API_KEY   -> goes straight to "paste the value"
#
# Safe to run repeatedly: replaces the existing line for that key, never duplicates.
set -e
cd "$(dirname "$0")/.."
ENV=".env"
[ -f "$ENV" ] || touch "$ENV"

NAME="$1"
if [ -z "$NAME" ]; then
  printf "Which key? (e.g. OPENAI_API_KEY): "
  read -r NAME
fi

printf "\nPaste the value for %s, then press Enter:\n> " "$NAME"
read -r VAL

# drop any existing line for this key, then add the new one at the end
grep -v "^${NAME}=" "$ENV" > "$ENV.tmp" 2>/dev/null || true
mv "$ENV.tmp" "$ENV"
echo "${NAME}=${VAL}" >> "$ENV"

echo ""
echo "✔ Saved ${NAME}. Your .env now holds these keys (values hidden):"
grep -o '^[A-Z_]*=' "$ENV" | sed 's/=$//' | sed 's/^/   /'
