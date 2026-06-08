/**
 * Chalk Talk · Cloudflare Worker proxy + RAG retrieval
 *
 * Endpoints:
 *   POST /v1/messages   →  Anthropic /v1/messages (transparent proxy)
 *   POST /retrieve      →  RAG: embed query → similarity search → chunks
 *   GET  /health        →  status + rag enabled flag
 *
 * Secrets needed:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
 */

const ALLOWED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
];
const ALLOWED_TOOL_TYPES = ["web_search_20250305"];
const DEFAULT_DAILY_LIMIT = 10;
const MAX_TOKENS_CAP = 6144;
const MAX_REQUEST_BYTES = 5_000_000;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const RETRIEVE_DEFAULT_MATCH_COUNT = 12;
const RETRIEVE_MAX_MATCH_COUNT = 50;
const ALLOWED_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
const ALLOWED_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"];
const ALLOWED_IMAGE_QUALITIES = ["low", "medium", "high", "auto"];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") return corsPreflight(origin, allowedOrigins);

    const url = new URL(request.url);

    // ── Public endpoints (no Origin allowlist) ─────────────────────────────
    // Share viewing must work from any origin: direct browser visits (no Origin
    // header), curl, embeds on other sites, social-card previewers, etc.
    if (request.method === "GET" && url.pathname.startsWith("/share/")) {
      return handleShareGet(request, env, ctx, "*", url);
    }

    if (!isOriginAllowed(origin, allowedOrigins))
      return jsonError(403, "origin_not_allowed", `Origin '${origin}' is not on this proxy's allowlist.`, "*");

    if (request.method === "GET" && url.pathname === "/health") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const used = await readDailyCount(env, ip);
      const limit = parseInt(env.DAILY_LIMIT_PER_IP || DEFAULT_DAILY_LIMIT);
      return jsonOK({
        ok: true,
        model_proxy: "chalk-talk",
        ratelimit: { used, limit, remaining: Math.max(0, limit - used) },
        rag: { enabled: !!(env.OPENAI_API_KEY && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) },
      }, origin);
    }

    if (request.method === "POST" && url.pathname === "/retrieve") {
      return handleRetrieve(request, env, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/images/generations") {
      return handleImageGeneration(request, env, ctx, origin);
    }

    // Sharing route is handled above (before Origin allowlist) since public viewers
    // legitimately have no Origin header (direct visits, curl, embeds).

    if (request.method !== "POST" || url.pathname !== "/v1/messages")
      return jsonError(404, "not_found", `Unknown endpoint ${request.method} ${url.pathname}`, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = parseInt(env.DAILY_LIMIT_PER_IP || DEFAULT_DAILY_LIMIT);
    const used = await readDailyCount(env, ip);
    if (used >= limit)
      return jsonError(429, "rate_limit_exceeded",
        `Daily limit reached (${limit} talks/day). Resets at midnight UTC.`,
        origin, { limit, used, resets_at: midnightUTC() });

    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES)
      return jsonError(413, "request_too_large", `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`, origin);

    let body;
    try { body = JSON.parse(raw); }
    catch { return jsonError(400, "invalid_json", "Request body is not valid JSON.", origin); }

    if (!body.model || !ALLOWED_MODELS.includes(body.model))
      return jsonError(400, "model_not_allowed", `Model '${body.model}' not allowed.`, origin);
    if (!Array.isArray(body.messages))
      return jsonError(400, "missing_messages", "messages array is required.", origin);
    if (body.max_tokens && body.max_tokens > MAX_TOKENS_CAP) body.max_tokens = MAX_TOKENS_CAP;
    if (body.tools) {
      if (!Array.isArray(body.tools))
        return jsonError(400, "tools_invalid", "tools must be an array.", origin);
      for (const t of body.tools) {
        if (!t || !ALLOWED_TOOL_TYPES.includes(t.type))
          return jsonError(400, "tool_not_allowed", `Tool type '${t && t.type}' not allowed.`, origin);
      }
    }

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

    if (upstream.ok) ctx.waitUntil(incrementDailyCount(env, ip));

    const respHeaders = new Headers(upstream.headers);
    respHeaders.set("Access-Control-Allow-Origin", origin || "*");
    respHeaders.set("Vary", "Origin");
    respHeaders.set("X-RateLimit-Limit", String(limit));
    respHeaders.set("X-RateLimit-Remaining", String(Math.max(0, limit - used - (upstream.ok ? 1 : 0))));
    respHeaders.set("X-RateLimit-Reset", midnightUTC());

    return new Response(upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: respHeaders,
    });
  },
};

async function handleRetrieve(request, env, origin) {
  if (!env.OPENAI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
    return jsonError(503, "rag_not_configured",
      "RAG not configured. Need OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY secrets.", origin);

  const raw = await request.text();
  if (raw.length > 50_000)
    return jsonError(413, "request_too_large", "Retrieve query body too large.", origin);

  let body;
  try { body = JSON.parse(raw); }
  catch { return jsonError(400, "invalid_json", "Request body is not valid JSON.", origin); }

  const query = (body.query || "").toString().trim();
  if (!query || query.length < 3)
    return jsonError(400, "missing_query", "`query` (string, min 3 chars) is required.", origin);
  if (query.length > 4000)
    return jsonError(400, "query_too_long", "`query` must be ≤4000 chars.", origin);

  const matchCount = Math.min(
    parseInt(body.match_count) || RETRIEVE_DEFAULT_MATCH_COUNT,
    RETRIEVE_MAX_MATCH_COUNT
  );
  // Backstop floor: if the caller doesn't specify, drop the weakly-related tail
  // (raw cosine over title+abstract vs a short query; <0.30 is mostly noise).
  const minSimilarity = typeof body.min_similarity === "number" ? body.min_similarity : 0.30;
  const maxAgeYears = (body.max_age_years == null) ? null : parseInt(body.max_age_years);
  const allowedSources = Array.isArray(body.allowed_sources) && body.allowed_sources.length > 0 ? body.allowed_sources : null;
  const tierBoostWeight = typeof body.tier_boost_weight === "number" ? body.tier_boost_weight : 0.05;

  let embedding;
  try { embedding = await embedQuery(env.OPENAI_API_KEY, query); }
  catch (err) { return jsonError(502, "embedding_failed", "Failed to embed query: " + err.message, origin); }

  let chunks;
  try {
    chunks = await callMatchChunks(env, {
      query_embedding: embedding,
      match_count: matchCount,
      min_similarity: minSimilarity,
      max_age_years: maxAgeYears,
      allowed_sources: allowedSources,
      tier_boost_weight: tierBoostWeight,
    });
  } catch (err) {
    return jsonError(502, "retrieval_failed", "Failed to retrieve chunks: " + err.message, origin);
  }

  return jsonOK({ query, count: chunks.length, chunks }, origin);
}

async function handleImageGeneration(request, env, ctx, origin) {
  if (!env.OPENAI_API_KEY)
    return jsonError(503, "openai_not_configured", "OpenAI image generation is not configured on this proxy.", origin);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = parseInt(env.DAILY_LIMIT_PER_IP || DEFAULT_DAILY_LIMIT);
  const used = await readDailyCount(env, ip);
  if (used >= limit)
    return jsonError(429, "rate_limit_exceeded",
      `Daily limit reached (${limit} generations/day). Resets at midnight UTC.`,
      origin, { limit, used, resets_at: midnightUTC() });

  const raw = await request.text();
  if (raw.length > 40_000)
    return jsonError(413, "request_too_large", "Image generation request body is too large.", origin);

  let body;
  try { body = JSON.parse(raw); }
  catch { return jsonError(400, "invalid_json", "Request body is not valid JSON.", origin); }

  const prompt = (body.prompt || "").toString().trim();
  if (!prompt || prompt.length < 3)
    return jsonError(400, "missing_prompt", "`prompt` (string, min 3 chars) is required.", origin);
  if (prompt.length > 32_000)
    return jsonError(400, "prompt_too_long", "`prompt` must be ≤32000 chars.", origin);

  const model = ALLOWED_IMAGE_MODELS.includes(body.model) ? body.model : "gpt-image-1.5";
  const size = ALLOWED_IMAGE_SIZES.includes(body.size) ? body.size : "1536x1024";
  const quality = ALLOWED_IMAGE_QUALITIES.includes(body.quality) ? body.quality : "high";
  const n = Math.max(1, Math.min(parseInt(body.n) || 1, 1));

  let upstream;
  try {
    upstream = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size, quality, n }),
    });
  } catch (err) {
    return jsonError(502, "upstream_unreachable", "Could not reach OpenAI Images API: " + err.message, origin);
  }

  if (upstream.ok) ctx.waitUntil(incrementDailyCount(env, ip));

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Access-Control-Allow-Origin": origin || "*",
      "Vary": "Origin",
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(Math.max(0, limit - used - (upstream.ok ? 1 : 0))),
      "X-RateLimit-Reset": midnightUTC(),
    },
  });
}

async function embedQuery(openaiKey, text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function callMatchChunks(env, params) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/match_chunks`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

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
  const ttl = Math.max(60, Math.ceil((new Date(midnightUTC()).getTime() - Date.now()) / 1000) + 60);
  await env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: ttl });
}
function todayUTC() { return new Date().toISOString().slice(0, 10); }
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

// ───────────────────────────────────────────────────────────────────────────
// Sharing handler — GET /share/:token (Jenni 2026-06-04)
// Looks up a public talk by share_token via Supabase REST (anon key),
// strips author PII, returns JSON with 5-min edge cache.
// ───────────────────────────────────────────────────────────────────────────
async function handleShareGet(request, env, ctx, origin, url) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonError(503, "supabase_unconfigured", "Sharing backend not available.", origin);
  }
  const token = url.pathname.replace("/share/", "").split("/")[0].trim();
  if (!token || !/^[a-f0-9-]{36}$/i.test(token)) {
    return jsonError(400, "bad_token", "Invalid share token.", origin);
  }

  // Cloudflare edge cache for hot tokens
  const cacheKey = new Request(`https://chalk-talk-cache/share/${token}`, request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Query Supabase REST — RLS policy `public_talks_readable` permits anon reads where is_public=true.
  const select = encodeURIComponent("id,title,topic,style,depth,talk_json,created_at,user_id");
  const supaUrl = `${env.SUPABASE_URL}/rest/v1/talks?share_token=eq.${token}&is_public=eq.true&select=${select}`;
  const supaRes = await fetch(supaUrl, {
    headers: {
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!supaRes.ok) {
    return jsonError(502, "upstream_error", `Supabase lookup failed: ${supaRes.status}`, origin);
  }
  const rows = await supaRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonError(404, "not_found", "No public talk with that share link.", origin);
  }

  const row = rows[0];
  const userId = row.user_id;
  // Lookup author display name from profiles (decoration — failure is non-fatal)
  let authorName = null;
  if (userId) {
    try {
      const profUrl = `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=name,role,specialty,institution`;
      const profRes = await fetch(profUrl, {
        headers: {
          "apikey": env.SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
      });
      if (profRes.ok) {
        const profs = await profRes.json();
        if (profs[0]) authorName = profs[0].name || null;
      }
    } catch (e) { /* swallow */ }
  }

  // Strip PII — never return user_id, email, etc.
  const payload = {
    id: row.id,
    title: row.title,
    topic: row.topic,
    style: row.style,
    depth: row.depth,
    talk_json: row.talk_json,
    created_at: row.created_at,
    author: authorName ? { name: authorName } : null,
  };

  const resp = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin || "*",
      "cache-control": "public, max-age=300, s-maxage=300", // 5-min edge cache
    },
  });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}
