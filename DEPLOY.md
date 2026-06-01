# Deploying the Chalk Talk proxy

This walks through standing up the Cloudflare Worker that lets visitors use Chalk Talk without their own API key. Total time: ~10 minutes. Cost: free tier (100k requests/day) is plenty.

## Prerequisites

- A free Cloudflare account: <https://dash.cloudflare.com/sign-up>
- Node 18+ (for `wrangler`)
- Your Anthropic API key

## 1. Install Wrangler & log in

```bash
npm install -g wrangler        # or: npx wrangler ...
wrangler login                 # opens a browser to auth with Cloudflare
```

## 2. Create the KV namespace for rate limiting

```bash
cd "/path/to/chalk talk"
wrangler kv namespace create RATE_LIMIT_KV
```

Wrangler prints something like:

```
🌀 Creating namespace with title "chalk-talk-proxy-RATE_LIMIT_KV"
✨ Success!
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "abc123def456..."
```

Copy that `id` value into `wrangler.toml`, replacing `YOUR_KV_NAMESPACE_ID_HERE`.

## 3. Set your allowed origins

Edit `wrangler.toml`. Change `ALLOWED_ORIGINS` to your live site URL(s):

```toml
[vars]
ALLOWED_ORIGINS = "https://tangjennii.github.io,http://localhost:8000,http://127.0.0.1:8000"
```

Anything not on this list gets a 403 from the proxy. Keep `localhost` entries while you're developing; remove them before submitting publicly if you want the URL to be unguessable.

## 4. Store your Anthropic key as a secret

```bash
wrangler secret put ANTHROPIC_API_KEY
# paste the key when prompted; it's stored encrypted, never readable again
```

## 5. Deploy

```bash
wrangler deploy
```

You'll get a URL like `https://chalk-talk-proxy.YOUR-SUBDOMAIN.workers.dev`. Test it:

```bash
curl https://chalk-talk-proxy.YOUR-SUBDOMAIN.workers.dev/health \
  -H "Origin: https://tangjennii.github.io"
# → {"ok":true,"model_proxy":"chalk-talk","ratelimit":{"used":0,"limit":10,"remaining":10}}
```

## 6. Wire the proxy into the app

Open `index.html` and find the `PROXY_CONFIG` block near the top:

```js
var PROXY_CONFIG = {
  enabled: false,
  url: ""
};
```

Set both:

```js
var PROXY_CONFIG = {
  enabled: true,
  url: "https://chalk-talk-proxy.YOUR-SUBDOMAIN.workers.dev"
};
```

Commit & push. Once GitHub Pages redeploys, the **Generate** button works without anyone setting an API key. Power users can flip the **Use my own key** toggle in the header to bypass the proxy and the rate limit.

## Tuning

**Raise / lower the daily limit per visitor:**

```toml
[vars]
DAILY_LIMIT_PER_IP = "25"      # was 10
```

Then `wrangler deploy` again — no code change needed.

**Add another allowed origin** (e.g. a custom domain): edit `ALLOWED_ORIGINS`, redeploy.

**Watch live traffic:** `wrangler tail`

**Hard kill the proxy** (e.g. if you wake up to a $200 Anthropic bill): `wrangler delete chalk-talk-proxy` — visitors immediately fall back to BYOK.

## Cost expectations

- Cloudflare Workers free tier: 100k requests/day, free
- Cloudflare KV free tier: 100k reads + 1k writes/day, free
- Anthropic API: roughly $0.02–0.05 per chalk talk (Sonnet draft + Haiku critique). With a 10/IP/day cap and 100 unique visitors/day, you're looking at <$30/day worst case — but most visitors will only generate 1–2 talks, so realistic cost is single-digit dollars/day.

If spend gets out of hand, drop `DAILY_LIMIT_PER_IP` to 3 or set up an Anthropic [usage budget alert](https://console.anthropic.com/settings/limits).

## Security notes

- The proxy enforces an origin allowlist, so only requests from your deployed site will succeed. Someone running locally could spoof the `Origin` header — for the threat model of "med-ed teaching tool," this is fine, but be aware.
- The proxy whitelists specific Claude models and tools (only built-in `web_search`). An abuser can't sneak in arbitrary models or tool calls.
- Rate limit is per-IP-per-day. A determined abuser on a residential ISP will cycle IPs every few hours. For higher protection, add a Cloudflare Turnstile challenge — out of scope here.
