/**
 * Chalk Talk · Cloudflare Worker proxy
 *
 * Lets visitors hit the Anthropic API without their own key, while:
 *   • holding YOUR key as a Worker secret (never exposed to browsers)
 *   • rate-limiting per visitor IP (default: 10 talks / day)
 *   • restricting which origins (domains) can call the proxy
 *   • whitelisting models + tools so abusers can't request arbitrary models/tools
 *
 * The deployed app keeps a "Use my own key" toggle so power users can still
 * BYOK and bypass the rate limit entirely.
 *
 * Deploy: see DEPLOY.md
 *
 *   POST /v1/messages   →  Anthropic /v1/messages (transparent proxy)
 *   GET  /health        →  { ok: true, ratelimit: <remaining for this IP> }
 *
 * Bindings expected (set in wrangler.toml + `wrangler secret put`):
 *   • secret  ANTHROPIC_API_KEY
 *   • var     ALLOWED_ORIGINS         (comma-separated; e.g. "https://x.github.io,http://localhost:8000")
 *   • var     DAILY_LIMIT_PER_IP      (string-number; default "10")
 *   • kv      RATE_LIMIT_KV           (Cloudflare KV namespace for daily counters)
 */

const ALLOWED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
];

const ALLOWED_TOOL_TYPES = [
  "web_search_20250305", // Anthropic's built-in web search; opt-in via the app
];

const DEFAULT_DAILY_LIMIT = 10;
const MAX_TOKENS_CAP = 6144;
const MAX_REQUEST_BYTES = 5_000_000;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

    // ── CORS preflight ────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return corsPreflight(origin, allowedOrigins);
    }

    // ── Origin lock ───────────────────────────────────────────────────
    if (!isOriginAllowed(origin, allowedOrigins)) {
      return jsonError(403, "origin_not_allowed", `Origin '${origin}' is not on this proxy's allowlist.`, "*");
    }

    const url = new URL(request.url);

    // ── Health check ──────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/health") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const used = await readDailyCount(env, ip);
      const limit = parseInt(env.DAILY_LIMIT_PER_IP || DEFAULT_DAILY_LIMIT);
      return jsonOK({ ok: true, model_proxy: "chalk-talk", ratelimit: { used, limit, remaining: Math.max(0, limit - used) } }, origin);
    }

    // ── Only POST /v1/messages is forwarded ───────────────────────────
    if (request.method !== "POST" || url.pathname !== "/v1/messages") {
      return jsonError(404, "not_found", `Unknown endpoint ${request.method} ${url.pathname}`, origin);
    }

    // ── Per-IP daily rate limit ───────────────────────────────────────
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = parseInt(env.DAILY_LIMIT_PER_IP || DEFAULT_DAILY_LIMIT);
    const used = await readDailyCount(env, ip);
    if (used >= limit) {
      return jsonError(
        429,
        "rate_limit_exceeded",
        `Daily limit reached (${limit} talks/day). Resets at midnight UTC. Use your own API key in the app for unlimited generation.`,
        origin,
        { limit, used, resets_at: midnightUTC() }
      );
    }

    // ── Read & validate body ──────────────────────────────────────────
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) {
      return jsonError(413, "request_too_large", `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`, origin);
    }

    let body;
    try { body = JSON.parse(raw); }
    catch { return jsonError(400, "invalid_json", "Request body is not valid JSON.", origin); }

    if (!body.model || !ALLOWED_MODELS.includes(body.model)) {
      return jsonError(400, "model_not_allowed", `Model '${body.model}' not allowed. Allowed: ${ALLOWED_MODELS.join(", ")}.`, origin);
    }
    if (!Array.isArray(body.messages)) {
      return jsonError(400, "missing_messages", "messages array is required.", origin);
    }
    if (body.max_tokens && body.max_tokens > MAX_TOKENS_CAP) {
      body.max_tokens = MAX_TOKENS_CAP;
    }
    if (body.tools) {
      if (!Array.isArray(body.tools)) {
        return jsonError(400, "tools_invalid", "tools must be an array.", origin);
      }
      for (const t of body.tools) {
        if (!t || !ALLOWED_TOOL_TYPES.includes(t.type)) {
          return jsonError(400, "tool_not_allowed", `Tool type '${t && t.type}' not allowed. Allowed: ${ALLOWED_TOOL_TYPES.join(", ")}.`, origin);
        }
      }
    }

    // ── Forward to Anthropic ──────────────────────────────────────────
    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return jsonError(502, "upstream_unreachable", "Could not reach Anthropic API: " + err.message, origin);
    }

    // ── Increment rate counter on success only ────────────────────────
    if (upstream.ok) {
      ctx.waitUntil(incrementDailyCount(env, ip));
    }

    // ── Pipe response back with CORS + rate-limit headers ─────────────
    const respHeaders = new Headers(upstream.headers);
    respHeaders.set("Access-Control-Allow-Origin", origin || "*");
    respHeaders.set("Vary", "Origin");
    respHeaders.set("X-RateLimit-Limit", String(limit));
    respHeaders.set("X-RateLimit-Remaining", String(Math.max(0, limit - used - (upstream.ok ? 1 : 0))));
    respHeaders.set("X-RateLimit-Reset", midnightUTC());

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────

function parseAllowedOrigins(varValue) {
  if (!varValue) return [];
  return varValue.split(",").map(s => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin, list) {
  if (list.includes("*")) return true;
  if (!origin) return false;
  return list.includes(origin);
}

function corsPreflight(origin, allowedOrigins) {
  const allowedOrigin = isOriginAllowed(origin, allowedOrigins) ? origin : "";
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}

async function readDailyCount(env, ip) {
  if (!env.RATE_LIMIT_KV) return 0;
  const key = `rl:${todayUTC()}:${ip}`;
  const v = await env.RATE_LIMIT_KV.get(key);
  return v ? parseInt(v) : 0;
}

async function incrementDailyCount(env, ip) {
  if (!env.RATE_LIMIT_KV) return;
  const key = `rl:${todayUTC()}:${ip}`;
  const current = await env.RATE_LIMIT_KV.get(key);
  const next = (current ? parseInt(current) : 0) + 1;
  // TTL = until midnight UTC + a small buffer
  const ttl = Math.max(60, Math.ceil((new Date(midnightUTC()).getTime() - Date.now()) / 1000) + 60);
  await env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: ttl });
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function midnightUTC() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

function jsonOK(obj, origin) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || "*",
      "Vary": "Origin",
    },
  });
}

function jsonError(status, type, message, origin, extra) {
  const payload = { error: { type, message } };
  if (extra) payload.error.detail = extra;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || "*",
      "Vary": "Origin",
    },
  });
}
