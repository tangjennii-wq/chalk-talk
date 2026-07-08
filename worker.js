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
  "claude-opus-4-8",            // current MODEL_MAIN in index.html (was being rejected)
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
];
const ALLOWED_TOOL_TYPES = ["web_search_20250305"];
const DEFAULT_DAILY_LIMIT = 10;
// Raised from 6144 → 32768: the app legitimately requests up to 16384 (detailed talks)
// and 32768 (refines). The old cap silently truncated talks routed through the proxy.
const MAX_TOKENS_CAP = 32768;
const MAX_REQUEST_BYTES = 5_000_000;

// ── Free tier (FREE_TIER_SPEC.md) ──────────────────────────────────────────
// Signed-in users get N free talks + N free images on Jenni's key, metered against
// a system-wide monthly spend cap. After that they bring their own key (BYOK goes
// direct to Anthropic, never touches this Worker). Defaults overridable via env vars.
const FREE_TALKS_DEFAULT = 10;
const FREE_IMAGES_DEFAULT = 5;
const MAX_MONTHLY_SPEND_USD_DEFAULT = 250;
// Per-million-token prices in USD (2026-06). Update if Anthropic pricing changes.
const MODEL_PRICES = {
  "claude-opus-4-8":            { in: 15.0, out: 75.0, cache: 1.5 },
  "claude-opus-4-6":            { in: 15.0, out: 75.0, cache: 1.5 },
  "claude-sonnet-4-6":          { in: 3.0,  out: 15.0, cache: 0.3 },
  "claude-sonnet-4-20250514":   { in: 3.0,  out: 15.0, cache: 0.3 },
  "claude-haiku-4-5-20251001":  { in: 0.8,  out: 4.0,  cache: 0.08 },
};
const IMAGE_FLAT_CENTS = 8;   // gpt-image-1.5 high quality ≈ $0.08/image
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

    // BYOK ChatGPT text — proxy only (OpenAI blocks browser CORS). Uses the USER's own key from the
    // X-Provider-Key header; never stored, no free-tier quota. (Jenni 2026-07-03)
    if (request.method === "POST" && url.pathname === "/v1/openai/chat") {
      return handleOpenAIChat(request, env, origin);
    }

    // Background generation (Jenni 2026-07-03) — survives mobile backgrounding. Submit returns a
    // jobId instantly; the heavy Claude draft+critique run server-side via ctx.waitUntil; the client
    // polls. Requires the JOBS_KV binding + Workers Paid plan.
    if (request.method === "POST" && url.pathname === "/generate-async") {
      return handleGenerateAsync(request, env, ctx, origin);
    }
    if (request.method === "GET" && url.pathname.indexOf("/generate-status/") === 0) {
      return handleGenerateStatus(decodeURIComponent(url.pathname.slice(17)), env, origin);
    }
    if (request.method === "POST" && url.pathname.indexOf("/generate-cancel/") === 0) {
      return handleGenerateCancel(decodeURIComponent(url.pathname.slice(17)), env, origin);
    }

    // ── Free tier endpoints (FREE_TIER_SPEC.md §5) ──────────────────────────
    if (request.method === "GET" && url.pathname === "/v1/free-tier/status") {
      return handleFreeTierStatus(request, env, origin);
    }
    if (request.method === "POST" && url.pathname === "/v1/free-tier/consume") {
      return handleFreeTierConsume(request, env, origin);
    }
    if (request.method === "POST" && url.pathname === "/v1/free-tier/admin/bonus") {
      return handleFreeTierBonus(request, env, origin);
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

    // ── Free-tier path ──────────────────────────────────────────────────────
    // The frontend sends X-Supabase-Auth (the user's access token) for signed-in
    // users who haven't set their own key. We verify the user, enforce the
    // system-wide spend cap, consume 1 talk of quota for primary generations
    // (X-CT-Meter: talk), forward on Jenni's key, and meter actual cost async.
    const supaToken = request.headers.get("X-Supabase-Auth");
    if (supaToken && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const meterKind = request.headers.get("X-CT-Meter") || "aux";   // 'talk' | 'aux'
      const monthKey = new Date().toISOString().slice(0, 7);

      const user = await verifySupabaseUser(env, supaToken);
      if (!user) return jsonError(401, "auth_invalid", "Sign-in token was rejected. Sign in again.", origin);

      // System-wide spend cap — backstop so cost can't run away.
      const capCents = freeCapCents(env);
      const spentCents = await getMonthlySpendCents(env, monthKey);
      if (spentCents >= capCents) {
        return jsonError(503, "free_tier_paused",
          "Chalk Talk's free tier is paused for this month. Add your own Anthropic key to keep going.",
          origin, { resumes_on: nextMonthFirstDayUTC() });
      }

      // NOTE: quota is consumed exactly once per generation via POST /v1/free-tier/consume
      // (called by the frontend before it starts). We do NOT consume here, because a single
      // generation makes several /v1/messages calls (draft + peer review, plus 529 retries and
      // model fallbacks) — charging per call would burn multiple talks for one generation.
      let upstreamF;
      try {
        upstreamF = await fetch("https://api.anthropic.com/v1/messages", {
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
      if (!upstreamF.ok && upstreamF.status === 401) {
        return jsonError(503, "upstream_auth_failed", "Free tier is temporarily unavailable. Add your own key to continue.", origin);
      }
      // Meter real cost from the response (works for both streamed + non-streamed) — async.
      if (upstreamF.ok) {
        ctx.waitUntil(meterCost(env, upstreamF.clone(), body.model, meterKind === "talk" ? "talk" : "aux", monthKey));
      }
      const fHeaders = new Headers(upstreamF.headers);
      fHeaders.set("Access-Control-Allow-Origin", origin || "*");
      fHeaders.set("Vary", "Origin");
      return new Response(upstreamF.body, { status: upstreamF.status, statusText: upstreamF.statusText, headers: fHeaders });
    }

    // ── Legacy / demo path (per-IP daily limit on Jenni's key) ──────────────
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

// ───────────────────────────────────────────────────────────────────────────
// Free tier helpers (Jenni 2026-06-22)
// ───────────────────────────────────────────────────────────────────────────
function freeTalks(env)  { return parseInt(env.FREE_TALKS  || FREE_TALKS_DEFAULT); }
function freeImages(env) { return parseInt(env.FREE_IMAGES || FREE_IMAGES_DEFAULT); }
function freeCapCents(env) { return parseInt(env.MAX_MONTHLY_SPEND_USD || MAX_MONTHLY_SPEND_USD_DEFAULT) * 100; }
function nextMonthFirstDayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

// Verify a Supabase access token by asking Supabase who it belongs to. Robust to
// HS256 *or* asymmetric (ES256/RS256) signing — we let Supabase do the crypto.
async function verifySupabaseUser(env, token) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return (u && u.id) ? { id: u.id, email: u.email } : null;
  } catch (e) { return null; }
}

async function supaServiceRPC(env, fn, params) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${fn} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

async function getMonthlySpendCents(env, monthKey) {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/spend_ledger?month_key=eq.${monthKey}&select=total_cents`,
      { headers: { "apikey": env.SUPABASE_SERVICE_ROLE_KEY, "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return (rows && rows[0] && rows[0].total_cents) || 0;
  } catch (e) { return 0; }
}

// Atomic consume. Returns true if quota was available (and was decremented).
async function consumeQuota(env, userId, kind, envForBase) {
  try {
    const base = kind === "image" ? freeImages(envForBase || env) : freeTalks(envForBase || env);
    const r = await supaServiceRPC(env, "free_tier_consume", {
      p_user_id: userId, p_kind: kind, p_amount: 1, p_base: base,
    });
    return r === true;
  } catch (e) { return false; }
}

function estimateCostCents(model, usage) {
  const p = MODEL_PRICES[model] || MODEL_PRICES["claude-sonnet-4-6"];
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheTok = usage.cache_read_input_tokens || 0;
  const dollars = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out + (cacheTok / 1e6) * p.cache;
  return Math.ceil(dollars * 100);
}

async function extractUsage(resp) {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  try {
    const text = await resp.text();
    if (text.indexOf("message_start") >= 0 || (text.indexOf("data:") >= 0 && text.indexOf("message_delta") >= 0)) {
      // SSE stream — pull input from message_start, output from message_delta.
      const lines = text.split("\n");
      for (const line of lines) {
        const ln = line.trim();
        if (!ln.startsWith("data:")) continue;
        const payload = ln.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const e = JSON.parse(payload);
          if (e.type === "message_start" && e.message && e.message.usage) {
            usage.input_tokens = e.message.usage.input_tokens || 0;
            usage.cache_read_input_tokens = e.message.usage.cache_read_input_tokens || 0;
          }
          if (e.type === "message_delta" && e.usage && typeof e.usage.output_tokens === "number") {
            usage.output_tokens = e.usage.output_tokens;
          }
        } catch (_) {}
      }
    } else {
      const j = JSON.parse(text);
      if (j.usage) {
        usage.input_tokens = j.usage.input_tokens || 0;
        usage.output_tokens = j.usage.output_tokens || 0;
        usage.cache_read_input_tokens = j.usage.cache_read_input_tokens || 0;
      }
    }
  } catch (e) {}
  return usage;
}

async function meterCost(env, respClone, model, kind, monthKey) {
  try {
    const usage = await extractUsage(respClone);
    const cents = estimateCostCents(model, usage);
    if (cents > 0) {
      await supaServiceRPC(env, "ledger_add", {
        p_month: monthKey, p_kind: kind === "talk" ? "talk" : "aux",
        p_cost_cents: cents, p_cap_cents: freeCapCents(env),
      });
      // (Phase 2) if the RPC returns a crossed threshold, fire an alert email here.
    }
  } catch (e) { /* metering is best-effort; never block the user */ }
}

async function handleFreeTierStatus(request, env, origin) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return jsonError(503, "free_tier_unconfigured", "Free tier is not configured on this proxy.", origin);
  const token = request.headers.get("X-Supabase-Auth");
  if (!token) return jsonOK({ signed_in: false }, origin);
  const user = await verifySupabaseUser(env, token);
  if (!user) return jsonOK({ signed_in: false }, origin);

  let talksRemaining = freeTalks(env), imagesRemaining = freeImages(env);
  try {
    const r = await supaServiceRPC(env, "free_tier_remaining", {
      p_user_id: user.id, p_base_talks: freeTalks(env), p_base_images: freeImages(env),
    });
    const row = Array.isArray(r) ? r[0] : r;
    if (row) { talksRemaining = row.talks_remaining; imagesRemaining = row.images_remaining; }
  } catch (e) {}

  const monthKey = new Date().toISOString().slice(0, 7);
  const capCents = freeCapCents(env);
  const spentCents = await getMonthlySpendCents(env, monthKey);
  return jsonOK({
    signed_in: true,
    talks_remaining: talksRemaining,
    images_remaining: imagesRemaining,
    talks_total: freeTalks(env),
    images_total: freeImages(env),
    cap_hit: spentCents >= capCents,
    cap_pct_used: Math.min(100, Math.round((spentCents / capCents) * 100)),
  }, origin);
}

// Consume exactly one unit of quota for a generation. Called once by the frontend
// before it kicks off a talk (or image). Idempotent w.r.t. the multi-call generation
// pipeline because the frontend calls it once, not per API request.
async function handleFreeTierConsume(request, env, origin) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return jsonError(503, "free_tier_unconfigured", "Free tier is not configured on this proxy.", origin);
  const token = request.headers.get("X-Supabase-Auth");
  if (!token) return jsonError(401, "auth_required", "Sign in to use the free tier.", origin);
  const user = await verifySupabaseUser(env, token);
  if (!user) return jsonError(401, "auth_invalid", "Sign-in token was rejected. Sign in again.", origin);

  let kind = "talk";
  try { const b = JSON.parse(await request.text() || "{}"); if (b.kind === "image") kind = "image"; } catch (e) {}

  // System spend cap backstop.
  const monthKey = new Date().toISOString().slice(0, 7);
  if ((await getMonthlySpendCents(env, monthKey)) >= freeCapCents(env))
    return jsonError(503, "free_tier_paused", "Chalk Talk's free tier is paused for this month. Add your own key to continue.", origin, { resumes_on: nextMonthFirstDayUTC() });

  const ok = await consumeQuota(env, user.id, kind, env);
  if (!ok) {
    const msg = kind === "image"
      ? "You've used your free images. Add your own key to keep generating illustrations."
      : "You've used your free talks. Add your own Anthropic key (~$5 covers ~30 talks) to continue.";
    return jsonError(429, kind === "image" ? "image_quota_exceeded" : "quota_exceeded", msg, origin);
  }
  // Report remaining for the badge.
  let remaining = null;
  try {
    const r = await supaServiceRPC(env, "free_tier_remaining", {
      p_user_id: user.id, p_base_talks: freeTalks(env), p_base_images: freeImages(env),
    });
    const row = Array.isArray(r) ? r[0] : r;
    if (row) remaining = { talks_remaining: row.talks_remaining, images_remaining: row.images_remaining };
  } catch (e) {}
  return jsonOK({ consumed: true, kind, remaining }, origin);
}

async function handleFreeTierBonus(request, env, origin) {
  if (!env.ADMIN_TOKEN) return jsonError(503, "admin_unconfigured", "Admin endpoint not configured.", origin);
  if (request.headers.get("X-Admin-Token") !== env.ADMIN_TOKEN)
    return jsonError(403, "admin_forbidden", "Bad admin token.", origin);
  let body;
  try { body = JSON.parse(await request.text()); }
  catch { return jsonError(400, "invalid_json", "Body is not valid JSON.", origin); }
  if (!body.user_email) return jsonError(400, "missing_email", "user_email is required.", origin);
  try {
    const ok = await supaServiceRPC(env, "free_tier_grant_bonus", {
      p_email: String(body.user_email).toLowerCase(),
      p_bonus_talks: parseInt(body.bonus_talks) || 0,
      p_bonus_images: parseInt(body.bonus_images) || 0,
    });
    return jsonOK({ granted: ok === true }, origin);
  } catch (e) {
    return jsonError(502, "grant_failed", "Bonus grant failed: " + e.message, origin);
  }
}

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

  // Free-tier image quota — when the user is signed in and on Jenni's key.
  const supaToken = request.headers.get("X-Supabase-Auth");
  const isFreeTier = !!(supaToken && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  let freeUser = null, monthKey = null;
  if (isFreeTier) {
    monthKey = new Date().toISOString().slice(0, 7);
    freeUser = await verifySupabaseUser(env, supaToken);
    if (!freeUser) return jsonError(401, "auth_invalid", "Sign-in token was rejected. Sign in again.", origin);
    const spentCents = await getMonthlySpendCents(env, monthKey);
    if (spentCents >= freeCapCents(env))
      return jsonError(503, "free_tier_paused", "Free tier is paused for this month. Add your own key to continue.", origin, { resumes_on: nextMonthFirstDayUTC() });
    const ok = await consumeQuota(env, freeUser.id, "image", env);
    if (!ok) return jsonError(429, "image_quota_exceeded", "You've used your free images. Add your own key to keep generating illustrations.", origin);
  }

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

  if (upstream.ok && isFreeTier) {
    // Flat image cost into the same monthly spend ledger.
    ctx.waitUntil(supaServiceRPC(env, "ledger_add", {
      p_month: monthKey, p_kind: "image", p_cost_cents: IMAGE_FLAT_CENTS, p_cap_cents: freeCapCents(env),
    }).catch(() => {}));
  } else if (upstream.ok) {
    ctx.waitUntil(incrementDailyCount(env, ip));
  }

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

// BYOK ChatGPT text proxy (Jenni 2026-07-03). OpenAI blocks direct browser calls (no CORS), so the
// browser sends the user's OWN key in X-Provider-Key and we forward it server-side. The key is used
// for this one request and never stored; this path has NO free-tier quota (it's the user's account).
async function handleOpenAIChat(request, env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const corsOrigin = isOriginAllowed(origin, allowed) ? origin : "";
  const userKey = request.headers.get("X-Provider-Key") || "";
  if (userKey.indexOf("sk-") !== 0)
    return jsonError(400, "missing_key", "Missing or invalid OpenAI API key.", origin);
  const raw = await request.text();
  if (raw.length > 2_000_000)
    return jsonError(413, "request_too_large", "Request body too large.", origin);
  let body;
  try { body = JSON.parse(raw); }
  catch { return jsonError(400, "invalid_json", "Body is not valid JSON.", origin); }
  let upstream;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${userKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return jsonError(502, "upstream_error", "Could not reach OpenAI: " + (e && e.message || e), origin);
  }
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
      "Vary": "Origin",
    },
  });
}

// ── BACKGROUND GENERATION (Jenni 2026-07-03) ─────────────────────────────────────────────────
// Thin server-side runner: the browser has already assembled the draft (sys+content+models) and the
// critique (sys+prefix). We just execute those two Claude calls on the edge and stash the raw texts;
// the browser does all JSON parsing / citation cleanup on poll-complete (no prompt logic duplicated).

// Anthropic text call with model fallback on overload. Returns { text, modelUsed, usage }.
async function callAnthropicText(env, sys, content, maxTok, models, tools) {
  // Enforce the same allowlist + token cap as the synchronous /v1/messages path — a tampered client
  // can't push us onto an off-list or oversized model via the async route.
  models = (Array.isArray(models) ? models : []).filter(function(m){ return ALLOWED_MODELS.indexOf(m) >= 0; });
  if (!models.length) models = ["claude-opus-4-8", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
  maxTok = Math.min(Math.max(parseInt(maxTok) || 16384, 256), MAX_TOKENS_CAP);
  // Only allowlisted tool types survive (currently just web_search). Anything else is dropped.
  let safeTools = null;
  if (Array.isArray(tools) && tools.length) {
    safeTools = tools.filter(function(t){ return t && ALLOWED_TOOL_TYPES.indexOf(t.type) >= 0; });
    if (!safeTools.length) safeTools = null;
  }
  let lastErr;
  for (let i = 0; i < models.length; i++) {
    const reqBody = { model: models[i], max_tokens: maxTok || 16384, system: sys, messages: [{ role: "user", content: content }] };
    if (safeTools) reqBody.tools = safeTools;
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(reqBody),
      });
    } catch (e) { lastErr = e; continue; }
    if (r.ok) {
      const d = await r.json();
      // Concatenate ALL text blocks — with web_search the response also carries tool_use / tool_result
      // blocks, and the talk JSON can be split across multiple text blocks. (index.html does the same.)
      let text = "";
      for (const b of (d.content || [])) { if (b && b.type === "text" && b.text) text += b.text; }
      return { text, modelUsed: models[i], usage: d.usage || {} };
    }
    if ((r.status === 529 || r.status >= 500) && i < models.length - 1) { lastErr = new Error("overloaded " + r.status); continue; }
    let em = ""; try { em = (await r.json()).error?.message || ""; } catch (_) {}
    throw new Error("Anthropic " + r.status + (em ? ": " + em : ""));
  }
  throw lastErr || new Error("Anthropic call failed");
}

async function runGeneration(jobId, body, env) {
  const t0 = Date.now();
  async function updateJob(patch) {
    let cur = {};
    try { cur = JSON.parse((await env.JOBS_KV.get("job:" + jobId)) || "{}"); } catch (_) {}
    if (cur.cancelled) return false;
    await env.JOBS_KV.put("job:" + jobId, JSON.stringify(Object.assign({}, cur, patch, { updatedAt: new Date().toISOString() })), { expirationTtl: 600 });
    return true;
  }
  try {
    const d = body.draft || {};
    if (!(await updateJob({ stage: "drafting" }))) return;
    const draft = await callAnthropicText(env, d.sys, d.content, d.maxTok || 16384, d.models, d.tools);
    let critText = "", critUsage = null, critModel = null;
    if (body.critique && body.critique.sys) {
      if (!(await updateJob({ stage: "critique" }))) return;
      const critInput = (body.critique.prefix || "") + "\n\nDraft chalk talk to review:\n" + draft.text;
      const crit = await callAnthropicText(env, body.critique.sys, [{ type: "text", text: critInput }], body.critique.maxTok || 16384, body.critique.models);
      critText = crit.text; critUsage = crit.usage; critModel = crit.modelUsed;
    }
    // Final cancel check before we charge/finalize — a cancel that landed during critique must not
    // consume quota or mark done. (Jenni 2026-07-03)
    let curFinal = {};
    try { curFinal = JSON.parse((await env.JOBS_KV.get("job:" + jobId)) || "{}"); } catch (_) {}
    if (curFinal.cancelled) return;
    // Meter real spend into the ledger (authoritative for the $/mo cap).
    try {
      const monthKey = new Date().toISOString().slice(0, 7);
      let cents = estimateCostCents(draft.modelUsed, draft.usage || {});
      if (critUsage) cents += estimateCostCents(critModel, critUsage);
      if (cents > 0) await supaServiceRPC(env, "ledger_add", { p_month: monthKey, p_kind: "talk", p_cost_cents: cents, p_cap_cents: freeCapCents(env) });
    } catch (_) {}
    // Consume the user's 10-talk quota SERVER-SIDE for the async path. This is the fix for the async
    // quota invariant: the job runs to completion even if the user backgrounds/closes the tab and never
    // reconnects, so quota must be decremented here (not on the client) or a closed-tab job would be
    // a free talk. The SYNC path still consumes on the client; the frontend skips its consume when the
    // async path was used, so each generation charges exactly once. (Jenni 2026-07-03)
    try { if (body.userId) await consumeQuota(env, body.userId, "talk", env); } catch (_) {}
    await updateJob({ status: "done", result: { draftText: draft.text, critText: critText, modelUsed: draft.modelUsed }, elapsedSec: Math.round((Date.now() - t0) / 1000) });
  } catch (err) {
    const msg = (err && err.message) || "Generation failed";
    const code = /overload|529|5\d\d/.test(msg) ? "upstream_overloaded" : "gen_error";
    await updateJob({ status: "error", error: { code, message: msg } });
  }
}

async function handleGenerateAsync(request, env, ctx, origin) {
  if (!env.JOBS_KV) return jsonError(503, "async_unconfigured", "Background generation isn't configured (missing JOBS_KV binding).", origin);
  if (!env.ANTHROPIC_API_KEY) return jsonError(503, "no_key", "Server key not configured.", origin);
  const token = request.headers.get("X-Supabase-Auth");
  const user = token ? await verifySupabaseUser(env, token) : null;
  if (!user) return jsonError(401, "auth_required", "Sign in to use background generation.", origin);
  const monthKey = new Date().toISOString().slice(0, 7);
  if ((await getMonthlySpendCents(env, monthKey)) >= freeCapCents(env))
    return jsonError(503, "free_tier_paused", "Free tier is paused for this month. Add your own key to continue.", origin, { resumes_on: nextMonthFirstDayUTC() });
  // Enforce the per-user talk quota at submit time so a tampered client can't bypass the frontend's
  // out-of-quota gate by POSTing here directly. (The job also consumes atomically on success.)
  try {
    const rem = await supaServiceRPC(env, "free_tier_remaining", { p_user_id: user.id, p_base_talks: freeTalks(env), p_base_images: freeImages(env) });
    const row = Array.isArray(rem) ? rem[0] : rem;
    if (row && typeof row.talks_remaining === "number" && row.talks_remaining <= 0)
      return jsonError(403, "quota_exceeded", "You've used all your free talks. Add your own key to keep generating.", origin);
  } catch (_) { /* if the check fails, fall through — the atomic consume on completion is the backstop */ }
  const raw = await request.text();
  // Match the sync /v1/messages ceiling (MAX_REQUEST_BYTES) so uploads that work synchronously can also
  // use background mode instead of falling back. (Jenni 2026-07)
  if (raw.length > MAX_REQUEST_BYTES) return jsonError(413, "request_too_large", "Request too large — try a smaller reference file.", origin);
  let body;
  try { body = JSON.parse(raw); } catch { return jsonError(400, "invalid_json", "Body is not valid JSON.", origin); }
  body.userId = user.id;
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.JOBS_KV.put("job:" + jobId, JSON.stringify({ status: "running", stage: "drafting", createdAt: now, updatedAt: now }), { expirationTtl: 600 });
  ctx.waitUntil(runGeneration(jobId, body, env));
  return jsonOK({ jobId, createdAt: now }, origin);
}

async function handleGenerateStatus(jobId, env, origin) {
  if (!env.JOBS_KV) return jsonError(503, "async_unconfigured", "Background generation isn't configured.", origin);
  const raw = await env.JOBS_KV.get("job:" + jobId);
  if (!raw) return jsonError(404, "job_not_found", "Job expired or not found.", origin);
  let obj;
  try { obj = JSON.parse(raw); } catch { return jsonError(500, "bad_job", "Corrupt job record.", origin); }
  return jsonOK(obj, origin);
}

async function handleGenerateCancel(jobId, env, origin) {
  if (!env.JOBS_KV) return jsonOK({ status: "cancelled" }, origin);
  try {
    const cur = JSON.parse((await env.JOBS_KV.get("job:" + jobId)) || "{}");
    cur.cancelled = true;
    if (cur.status !== "done") cur.status = "cancelled";
    cur.updatedAt = new Date().toISOString();
    await env.JOBS_KV.put("job:" + jobId, JSON.stringify(cur), { expirationTtl: 600 });
  } catch (_) {}
  return jsonOK({ status: "cancelled" }, origin);
}

function corsPreflight(origin, allowedOrigins) {
  const allowedOrigin = isOriginAllowed(origin, allowedOrigins) ? origin : "";
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Supabase-Auth, X-CT-Meter, X-Admin-Token, X-Provider-Key, Authorization",
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
    // Phase 5 — Jenni 2026-06-08: include author user_id so viewers can detect
    // "this is my own talk" and the save-copy flow can stamp source_curator_user_id.
    author_user_id: row.user_id,
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
