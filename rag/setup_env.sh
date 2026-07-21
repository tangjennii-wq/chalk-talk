#!/usr/bin/env bash
# Interactive .env setup — asks you to paste each key one at a time.
# Run from the repo:  bash rag/setup_env.sh
set -e
cd "$(dirname "$0")/.."          # move to repo root regardless of where you run it

ENV=".env"
echo "SUPABASE_URL=https://hrcvcjiefndvytlcbmpa.supabase.co" > "$ENV"

echo ""
echo "Setting up your keys. Paste each one when asked, then press Enter."
echo "(Supabase -> chalktalk -> Settings -> API -> service_role secret;  OpenAI -> API keys)"

printf "\n1/3  Paste your Supabase service_role key, then Enter:\n> "
read -r K
echo "SUPABASE_SERVICE_ROLE_KEY=$K" >> "$ENV"

printf "\n2/3  Paste your OpenAI API key (sk-...), then Enter:\n> "
read -r K
echo "OPENAI_API_KEY=$K" >> "$ENV"

printf "\n3/3  Paste your NCBI API key, then Enter  (or just press Enter to skip):\n> "
read -r K
[ -n "$K" ] && echo "NCBI_API_KEY=$K" >> "$ENV"

echo ""
echo "✔ Saved .env. It now contains these keys (values hidden):"
grep -o '^[A-Z_]*=' "$ENV" | sed 's/=$//' | sed 's/^/   /'
echo ""
echo "Next step — run the ingest:"
echo "   node rag/ingest_landmarks.mjs"
