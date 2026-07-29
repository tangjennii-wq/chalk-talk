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
  "claude-opus-5",              // MODEL_MAIN as of 2026-07-26 — the only BENCHMARKED writer
  "claude-opus-4-8",            // previous MODEL_MAIN; kept so in-flight/older clients still work
  "claude-opus-4-6",
  "claude-sonnet-5",            // Sonnet fallback as of 2026-07-26 (Sonnet 4 is retired first-party)
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
];
// WRITERS CLEARED BY THE FROZEN BENCHMARK (must mirror WRITER_BENCHMARK_CLEARED in index.html).
// ALLOWED_MODELS above is the proxy's general allowlist — it legitimately includes older models for
// non-writing utility calls (podcast scripts, diagram prompts, chat). This list is stricter: it is the
// ONLY set permitted to write user-facing medical teaching content, and generation FAILS CLOSED against
// it. Add an id here only after a full 20-row pass in rag/MODEL_BENCHMARK.md. (Codex 2026-07-26)
const WRITER_CLEARED = [
  "claude-opus-5",
  // "claude-sonnet-5",  // pilot only: 6/6 on 3 topics. Needs the full 20 rows before it may write.
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
// Per-million-token prices in USD. VERIFIED against platform.claude.com/docs/en/about-claude/pricing
// on 2026-07-26. `cache` is the cache-HIT (read) rate = 0.1x base input.
//
// CORRECTION 2026-07-26: Opus was listed at $15/$75 — that is Opus 4.1/4.0 pricing. Opus 4.5 through
// Opus 5 are $5/$25, so this table was overstating every Opus call by 3x. Because these numbers drive
// MAX_MONTHLY_SPEND_USD, the $250 cap has been tripping at roughly a THIRD of the real spend, cutting
// the free tier off far earlier than intended. Haiku 4.5 was also slightly under-priced ($0.8/$4 vs the
// actual $1/$5).
const MODEL_PRICES = {
  "claude-opus-5":              { in: 5.0,  out: 25.0, cache: 0.5 },
  "claude-opus-4-8":            { in: 5.0,  out: 25.0, cache: 0.5 },
  "claude-opus-4-6":            { in: 5.0,  out: 25.0, cache: 0.5 },
  // Sonnet 5 is $2/$10 introductory THROUGH 2026-08-31, then $3/$15. Listed at the standard rate so the
  // cap errs conservative (over-counts slightly until September, never under-counts).
  "claude-sonnet-5":            { in: 3.0,  out: 15.0, cache: 0.3 },
  "claude-sonnet-4-6":          { in: 3.0,  out: 15.0, cache: 0.3 },
  "claude-sonnet-4-20250514":   { in: 3.0,  out: 15.0, cache: 0.3 },
  "claude-haiku-4-5-20251001":  { in: 1.0,  out: 5.0,  cache: 0.1 },
};
const IMAGE_FLAT_CENTS = 8;   // gpt-image-1.5 high quality ≈ $0.08/image
const EMBEDDING_MODEL = "text-embedding-3-small";
// (RERANK_POOL removed 2026-07-28. It encoded the assumption that a global top-N lookup could score the
// facet union; it cannot. score_candidate_chunks scores the union exactly, so there is no pool depth to
// choose and no arbitrary constant to get wrong.)

// ── STAGE 2 · METADATA FILTERING (2026-07-28) ────────────────────────────────────────────────────
// Publication types that cannot serve as teaching evidence regardless of how well they score. A
// correction notice about a diabetes trial embeds close to "diabetes" and carries no teaching content
// at all — precisely the kind of high-similarity, zero-value hit the D-1 investigation kept surfacing.
// PubMed does not emit tidy lowercase tokens. Real values include "Published Erratum", "Retracted
// Publication", "Clinical Trial Protocol", "Comment", "Letter", "Editorial". Normalize to canonical
// categories BEFORE any comparison, or an exact-set membership test silently misses most of them.
// (Codex, 2026-07-28)
const normalizePubType = (t) => String(t == null ? "" : t).toLowerCase().replace(/[^a-z]+/g, " ").trim();

// Substring probes against the NORMALIZED string, so "published erratum" and "retracted publication"
// both land. Matching on substrings is deliberate here: these labels appear with prefixes and suffixes
// that an equality test cannot anticipate.
const WEAK_PUB_PATTERNS = [
  "erratum", "correction", "retracted", "retraction", "withdrawn",
  "editorial", "letter", "comment", "news", "biography", "obituary",
  "protocol",              // covers "clinical trial protocol", "study protocol"
  "published erratum", "retracted publication",
];

// Titles announce these unambiguously even when publication_type was ingested as the catch-all "other",
// which is the common case. Anchored to the START of the title so a paper merely DISCUSSING a retraction
// is not excluded. (2026-07-28)
const WEAK_TITLE_RE = /^\s*(correction|erratum|retraction|withdrawn|comment on|reply to|author reply|editorial|letter to the editor)\b/i;

// Preference order when everything else is equal. NOT a filter — nothing is dropped for being low in
// this list. Codex, 2026-07-28: "Do not automatically exclude non-landmark papers — acute topics often
// depend on them." An "other"-typed paper may be exactly the practice review an acute topic needs.
const PUB_TYPE_RANK = { guideline: 0, systematic_review: 1, meta_analysis: 1, rct: 2, review: 3, drug_label: 4, other: 5 };
// normalized, so "Systematic Review" and "systematic_review" rank identically
const pubRank = (t) => { const k = normalizePubType(t).replace(/ /g, "_"); return PUB_TYPE_RANK[k] != null ? PUB_TYPE_RANK[k] : 5; };

// Returns a reason string when the source is CONFIDENTLY ineligible, else null.
// "other" and unknown values are NOT ineligible — uncertainty is not disqualification.
function isWeakSource(c) {
  const t = normalizePubType(c.publication_type);
  if (t) {
    for (const pat of WEAK_PUB_PATTERNS) if (t.includes(pat)) return "pub_type:" + t;
  }
  if (WEAK_TITLE_RE.test(String(c.title || ""))) return "title:" + String(c.title || "").slice(0, 40);
  return null;
}

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
      const limit = dailyLimit(env);
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
      return handleGenerateStatus(request, decodeURIComponent(url.pathname.slice(17)), env, origin);
    }
    if (request.method === "POST" && url.pathname.indexOf("/generate-cancel/") === 0) {
      return handleGenerateCancel(request, decodeURIComponent(url.pathname.slice(17)), env, origin);
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
    const limit = dailyLimit(env);
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
    //
    // PUT IT UNDER THE SAME CAP AND LEDGER AS EVERY OTHER PATH (2026-07-29 audit).
    // This branch spends ANTHROPIC_API_KEY and, until now, checked no monthly cap and wrote no ledger
    // row — so its spend was both uncapped and invisible to the cap every other path respects. Its only
    // stated guard was the per-IP daily counter, and that counter does nothing: RATE_LIMIT_KV is not
    // bound in wrangler.toml, so readDailyCount always returns 0 while /health reports the limit as
    // enforced with full headroom.
    //
    // Reaching it only requires OMITTING the X-Supabase-Auth header. Origin is checked, but Origin is a
    // client-supplied header and trivially set by any non-browser client.
    //
    // I did NOT close this path, deliberately. No shipped frontend uses it — PROXY_CONFIG.enabled is
    // false on both main and launch-integration, verified — but "no caller I can find" is not "no
    // caller", and silently 403-ing an unknown client while Jenni is away is the worse failure. Metering
    // it is strictly additive: every existing caller keeps working, the spend becomes visible, and it
    // stops at the same $250 backstop as everything else.
    // Recomputed rather than reused: meterKind and monthKey above are const-scoped to the free-tier
    // branch, so referencing them here is a ReferenceError at runtime — which `node --check` does not
    // catch, because it is a scope error and not a syntax error. Caught by reading, not by the check.
    const legacyMeterKind = request.headers.get("X-CT-Meter") || "aux";
    const legacyMonthKey = new Date().toISOString().slice(0, 7);
    const legacyCapCents = freeCapCents(env);
    const legacySpent = await getMonthlySpendCents(env, legacyMonthKey);
    if (legacySpent >= legacyCapCents) {
      return jsonError(503, "free_tier_paused",
        "Chalk Talk's free tier is paused for this month. Add your own Anthropic key to keep going.",
        origin, { resumes_on: nextMonthFirstDayUTC() });
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

    if (upstream.ok) {
      ctx.waitUntil(incrementDailyCount(env, ip));
      // Same metering as the free-tier branch, so this path's spend lands in spend_ledger and counts
      // toward the cap checked above rather than accruing off the books.
      ctx.waitUntil(meterCost(env, upstream.clone(), body.model,
                              legacyMeterKind === "talk" ? "talk" : "aux", legacyMonthKey));
    }

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
// A MALFORMED LIMIT MUST NOT BE AN ABSENT LIMIT (2026-07-29 audit).
// `parseInt("unlimited")` and `parseInt("250usd")` are NaN, and every comparison against NaN is false —
// so `used >= limit` and `spentCents >= capCents` both stop tripping. A typo in a dashboard variable
// silently switched the guard off, and /health rendered it as `null` (NaN serializes to null), which
// reads as "not configured" rather than "misconfigured". Fall back to the compiled-in default instead.
// parseInt IS NOT VALIDATION — it is a prefix parser (corrected 2026-07-29, second pass).
// My first version used parseInt and its own comment cited "250usd" as an example it rejects. It does
// not. parseInt stops at the first non-digit and returns what it got:
//
//   "250usd" -> 250     the exact example the comment claimed was caught
//   "1e3"    -> 1       someone writing 1000 in exponent form gets a $1 cap
//   "0x10"   -> 0       a $0 cap: every request blocked, looking like an exhausted budget
//   "250.7"  -> 250     silently truncated
//
// Two of those are worse than the NaN case they replaced, because NaN at least disabled the comparison
// visibly. A $1 cap looks exactly like a working cap. The suite passed because it only tested
// "unlimited", which happens to be the one malformed value parseInt does reject.
//
// Validate the WHOLE string, then convert.
function intEnv(raw, fallback, name) {
  if (raw == null || raw === "") return fallback;
  const s = String(raw).trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isInteger(n) || n < 0) {
    console.warn(`config: ${name}="${raw}" is not a non-negative integer; using default ${fallback}`);
    return fallback;
  }
  return n;
}
function freeTalks(env)  { return intEnv(env.FREE_TALKS,  FREE_TALKS_DEFAULT,  "FREE_TALKS"); }
function freeImages(env) { return intEnv(env.FREE_IMAGES, FREE_IMAGES_DEFAULT, "FREE_IMAGES"); }
function freeCapCents(env) {
  return intEnv(env.MAX_MONTHLY_SPEND_USD, MAX_MONTHLY_SPEND_USD_DEFAULT, "MAX_MONTHLY_SPEND_USD") * 100;
}
function dailyLimit(env) { return intEnv(env.DAILY_LIMIT_PER_IP, DEFAULT_DAILY_LIMIT, "DAILY_LIMIT_PER_IP"); }
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

// Refund one reserved talk/image (best-effort) when the work fails, so a consumed credit isn't burned on
// something that never produced output. grant_bonus is keyed by email. (Jenni 2026-07)
async function refundQuota(env, email, kind) {
  if (!email) return;
  const talks = kind === "image" ? 0 : 1, images = kind === "image" ? 1 : 0;
  try { await supaServiceRPC(env, "free_tier_grant_bonus", { p_email: String(email).toLowerCase(), p_bonus_talks: talks, p_bonus_images: images }); } catch (_) {}
}
async function refundQuotaTalk(env, email) { return refundQuota(env, email, "talk"); }

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

  // CLAMP AT BOTH ENDS (2026-07-29 audit). Math.min alone let a negative through: match_count:-5 is a
  // truthy parseInt, min(-5, 50) is -5, and `union.slice(0, -5)` silently drops the five BEST-ranked
  // chunks off the tail and returns the rest — while `count` reports that length as if the request had
  // been honoured. Also rejects NaN from a non-numeric value rather than falling through it.
  const requestedCount = parseInt(body.match_count);
  const matchCount = Math.min(
    Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : RETRIEVE_DEFAULT_MATCH_COUNT,
    RETRIEVE_MAX_MATCH_COUNT
  );
  // Backstop floor: if the caller doesn't specify, drop the weakly-related tail
  // (raw cosine over title+abstract vs a short query; <0.30 is mostly noise).
  const minSimilarity = typeof body.min_similarity === "number" ? body.min_similarity : 0.30;
  const maxAgeYears = (body.max_age_years == null) ? null : parseInt(body.max_age_years);
  const allowedSources = Array.isArray(body.allowed_sources) && body.allowed_sources.length > 0 ? body.allowed_sources : null;
  const tierBoostWeight = typeof body.tier_boost_weight === "number" ? body.tier_boost_weight : 0.05;

  // QUERY EXPANSION: the caller may send `queries` — several facet sub-queries (mechanism, diagnosis,
  // treatment, outcomes) alongside the bare topic. We embed them all in one call, retrieve for each, then
  // merge and dedupe by chunk, keeping each chunk's BEST ranked_score. This grounds every section of the
  // talk instead of only whatever the bare topic string happened to match. (Jenni 2026-07-10)
  let queries = Array.isArray(body.queries)
    ? body.queries.map(q => String(q || "").trim()).filter(q => q.length >= 3 && q.length <= 4000)
    : [];
  if (!queries.length) queries = [query];
  if (queries[0] !== query) queries.unshift(query);
  queries = queries.slice(0, 6);   // cap fan-out

  let embeddings;
  try { embeddings = await embedQueries(env.OPENAI_API_KEY, queries); }
  catch (err) { return jsonError(502, "embedding_failed", "Failed to embed query: " + err.message, origin); }

  // Per-query pull. Ask for a bit more than we'll keep so the merge has something to choose from.
  const perQuery = Math.min(RETRIEVE_MAX_MATCH_COUNT, Math.max(matchCount, 8));
  let merged;
  try {
    const runs = await Promise.all(embeddings.map(emb => callMatchChunks(env, {
      query_embedding: emb,
      match_count: perQuery,
      min_similarity: minSimilarity,
      max_age_years: maxAgeYears,
      allowed_sources: allowedSources,
      tier_boost_weight: tierBoostWeight,
    })));
    // Dedupe by chunk_id, keeping the highest ranked_score any sub-query achieved for it.
    const best = new Map();
    runs.forEach((rows, qi) => {
      (rows || []).forEach(r => {
        const k = r.chunk_id;
        const prev = best.get(k);
        if (!prev || (r.ranked_score || 0) > (prev.ranked_score || 0)) {
          best.set(k, Object.assign({}, r, { matched_query: queries[qi] }));
        }
      });
    });
    let union = Array.from(best.values());

    // ── STAGE 1 · RERANK AGAINST THE ORIGINAL TOPIC (opt-in, default OFF) ──────────────────────
    // The 2026-07-28 diagnostic showed facet scores are NOT comparable across queries: cosine against
    // "<topic> treatment, management and guideline recommendations" is a different quantity from cosine
    // against "<topic>". Pooling them by ranked_score is what let an off-topic valvular guideline score
    // 0.612 for HFrEF — higher than any chunk the DKA topic produced from any facet.
    //
    // The fix is to let the FACETS DISCOVER candidates (recall) and let the BARE TOPIC RANK them
    // (precision). queries[0] is guaranteed to be the bare topic — see the unshift above.
    //
    // This costs ONE extra match_chunks call and ZERO extra embedding calls, because every candidate
    // already has a stored embedding. It therefore ranks the SAME representation that was ingested,
    // rather than re-embedding a truncated copy — which would silently change the document
    // representation and could do the work the rerank is being credited for. (Codex, 2026-07-28)
    //
    // OFF BY DEFAULT. Production behaviour is unchanged until candidate-level precision/recall on the
    // labeled set says this helps. Build one stage, measure it, keep it only if it earns its place.
    const wantRerank = body.rerank === true;
    let rerankApplied = false, rerankScored = null, rerankUnscored = null;
    if (wantRerank && union.length) {
      try {
        // EXACT scoring of the union — not a global top-N lookup.
        //
        // The first version of this called match_chunks with match_count 300, believing that scored
        // "every union member". It did not: match_chunks ranks the WHOLE TABLE and returns a global
        // top-N, so a facet-discovered candidate outside the bare topic's global top 300 came back
        // absent, scored null, and ranked LAST. That is precisely backwards — a niche treatment paper
        // only a facet could surface is exactly the chunk that sits outside a global top-N.
        // score_candidate_chunks scores ONLY these ids, so every candidate gets a real number.
        // (Codex, 2026-07-28)
        //
        // ── SORT ON bare_ranked_score, NOT bare_similarity (Codex, 2026-07-29) ────────────────────
        // THE BUG THIS REPLACES. This block used to sort by raw cosine. But the order it was replacing —
        // match_chunks.ranked_score — is similarity PLUS four authority boosts: tier, landmark,
        // elite-journal and a capped RCR term. Sorting by raw cosine therefore did two things at once:
        // it reranked against the bare topic AND it repealed the authority policy. "Rerank ON" and
        // "rerank OFF" differed by two changes, so the four-arm experiment could not attribute a
        // difference to either, and would have reported the sum under the name of one of them.
        //
        // score_candidate_chunks now returns ranked_score computed with the IDENTICAL formula and
        // weights as production, substituting bare-topic similarity for facet similarity. The only
        // difference between arms is which query supplies the semantic term — which is what a rerank
        // is. bare_similarity is still carried, for diagnostics, but it does NOT drive the order.
        const ids = union.map(c => c.chunk_id).filter(Boolean);
        const bareRows = await callScoreCandidateChunks(env, embeddings[0], ids);
        const bare = new Map();
        (bareRows || []).forEach(r => bare.set(r.chunk_id, r));
        union.forEach(c => {
          const r = bare.get(c.chunk_id);
          c.bare_similarity   = (r && typeof r.similarity   === "number") ? r.similarity   : null;
          c.bare_ranked_score = (r && typeof r.ranked_score === "number") ? r.ranked_score : null;
        });
        // REFUSE TO RANK ON A MISSING COLUMN. If the deployed function is the older two-column version,
        // every bare_ranked_score is null and sorting on it would quietly reproduce the arrival order
        // while still reporting rerank_applied:true — the confound back again, now invisible. Treat it
        // as a failure and fall back loudly.
        //
        // THE FIRST VERSION OF THIS GUARD HAD THE SAME HOLE IT WAS GUARDING (2026-07-29, second pass).
        // It read `bare_similarity != null && bare_ranked_score == null`, which requires the lookup to
        // have SUCCEEDED for a row before it can complain that the row lacks a score. In the case that
        // actually matters — the whole lookup missing, because the RPC returned [], or an id type
        // mismatch made every Map hit fail — BOTH fields are null on every candidate, `some(...)` is
        // false, nothing throws, and the comparator computes -Infinity - -Infinity = NaN for every pair.
        // A NaN comparator leaves the array in arrival order in V8. So the union kept exactly the pooled
        // facet order the rerank exists to replace, and the response said rerank_applied:true.
        //
        // Guard on COVERAGE instead: how many candidates the RPC actually scored.
        if (!Array.isArray(bareRows)) {
          throw new Error("score_candidate_chunks returned a non-array: " + typeof bareRows);
        }
        if (ids.length && bare.size === 0) {
          throw new Error(`score_candidate_chunks scored 0 of ${ids.length} candidates — the RPC is `
                        + "present but matched nothing (id type mismatch, or an empty result); ranking "
                        + "on this would reproduce facet order while reporting a rerank");
        }
        if (union.some(c => c.bare_ranked_score == null && c.bare_similarity != null)) {
          throw new Error("score_candidate_chunks returned no ranked_score — deployed function predates "
                        + "the 2026-07-29 authority-parity fix; apply add_score_candidate_chunks.sql");
        }
        // A null here now means the row genuinely has no stored embedding — not "outside a top-N".
        // It still ranks last, but that is a data problem, and it is REPORTED (not merely logged) so it
        // cannot hide: a console.warn in a Worker is invisible to the evaluator reading the response.
        const unscored = union.filter(c => c.bare_ranked_score == null).length;
        if (unscored) console.warn(`rerank: ${unscored}/${union.length} candidates had no stored embedding`);
        rerankUnscored = unscored;
        rerankScored = bare.size;
        // PARTIAL COVERAGE IS NOT A RERANK (Codex, 2026-07-29, third pass).
        // The previous guard only rejected scoring ZERO candidates. Score 20 of 24 and it reported
        // rerank_applied:true with rerank_unscored:4 — but those four were forced to the bottom
        // regardless of merit, which is the exact global-top-N failure this stage was built to remove,
        // just smaller. Telemetry is not a substitute for a verdict: an experiment reading
        // rerank_applied:true has no reason to discard the topic, so a partial rerank would enter the
        // calibration as if it were a clean one.
        //
        // STRICT ONLY WHEN ASKED. Production tolerates a stale chunk missing an embedding — dropping a
        // whole talk's retrieval over one row would be worse for the user than a slightly imperfect
        // ordering. The evaluator sets strict_rerank:true so any incompleteness fails the arm loudly.
        if (unscored > 0 && body.strict_rerank === true) {
          throw new Error(`strict_rerank: ${unscored}/${union.length} candidates unscored — a partial `
                        + "rerank forces the remainder to the bottom regardless of merit, which is the "
                        + "failure this stage exists to remove");
        }
        // -Number.MAX_VALUE, not -Infinity: two unscored candidates must compare EQUAL (a finite
        // difference of 0), not NaN. NaN is falsy, so under `||` chaining it silently hands the decision
        // to the next comparator — see the authority tie-break below, where that made publication type
        // the primary key for unscored pairs.
        const key = (x) => (x.bare_ranked_score == null ? -Number.MAX_VALUE : x.bare_ranked_score);
        union.sort((a, b) => key(b) - key(a));
        rerankApplied = true;
      } catch (err) {
        // Fail OPEN to current behaviour rather than returning nothing — but say so, so a silent
        // fallback can never be mistaken for a successful rerank.
        console.warn("rerank failed, falling back to pooled facet order: " + err.message);
        union.sort((a, b) => (b.ranked_score || 0) - (a.ranked_score || 0));
      }
    } else {
      union.sort((a, b) => (b.ranked_score || 0) - (a.ranked_score || 0));
    }
    // ── STAGE 2 · METADATA FILTER (opt-in, default OFF) ───────────────────────────────────────
    // Runs AFTER the rerank so the two stages stay separately measurable — that is the whole point of
    // building them one at a time. Drops only sources that cannot be teaching evidence at all; it does
    // NOT drop on tier, and it does NOT drop non-landmark papers.
    let metadataFilterApplied = false, dropped = [], unionBeforeFilter = union.length;
    if (body.metadata_filter === true) {
      const kept = [];
      for (const c of union) {
        const why = isWeakSource(c);
        if (why) dropped.push({ title: String(c.title || "").slice(0, 80), reason: why });
        else kept.push(c);
      }
      // FAIL CLOSED on sources confidently classified as ineligible. (Codex, 2026-07-28)
      //
      // The first version restored everything when the filter would have emptied the union, reasoning
      // that an empty result was probably a metadata problem. That is unsafe: if every candidate is
      // positively identified as an erratum, a correction, an editorial or a retraction, restoring them
      // means deliberately handing known NON-EVIDENCE to a medical writer.
      //
      // Zero eligible local sources is not a system failure — it is the honest result. Later it triggers
      // the live fallback; absent that, the model teaches from knowledge and the response reports that
      // there was no eligible evidence. Note the asymmetry: we fail OPEN on an execution error (the
      // catch below) and fail CLOSED on a confident classification.
      union = kept;
      metadataFilterApplied = true;
    }

    // ── AUTHORITY TIE-BREAK — ITS OWN FLAG, default OFF (Codex, 2026-07-28) ───────────────────
    // This used to fire whenever EITHER rerank or metadata filtering was on, which quietly made
    // "rerank only" mean "rerank + authority ranking" and "metadata only" mean "filter + authority
    // ranking". Four arms exist to attribute a difference to ONE named stage; a hidden third
    // intervention riding along in two of them defeats the entire design.
    //
    // It is a third intervention on its own terms — a guideline outranking an "other" at equal
    // relevance is a real ranking opinion, not a formatting detail — so it gets a real flag and can be
    // measured as its own arm when someone wants to know whether it helps.
    const wantAuthority = body.authority_tiebreak === true;
    let authorityApplied = false;
    if (wantAuthority && union.length) {
      // PRIMARY KEY MUST BE THE SCORE THE ARM ACTUALLY RANKS BY (Codex, 2026-07-29).
      // This read bare_similarity in the reranked path, which is the same confound as the main sort:
      // enabling a "tie-break" would have re-sorted the whole union by raw cosine and discarded the
      // authority boosts, rather than merely ordering candidates whose scores are equal. It was never
      // enabled — all four calibration arms hold it OFF — so it corrupted no measurement. It was a
      // latent one, waiting for whoever turned the flag on and got a silently different ranking policy.
      //
      // pubRank is a TIE-BREAK, so it may only speak when the primary scores are equal.
      // -Number.MAX_VALUE for the same reason as the main sort: -Infinity minus -Infinity is NaN, NaN is
      // falsy, and `||` would then hand the whole decision to pubRank — making publication type the
      // PRIMARY key for every unscored pair, inside a comparator whose entire purpose is to be secondary.
      const primary = rerankApplied
        ? (x) => (x.bare_ranked_score == null ? -Number.MAX_VALUE : x.bare_ranked_score)
        : (x) => (typeof x.ranked_score === "number" ? x.ranked_score : -Number.MAX_VALUE);
      // Exact float equality is the right test here: a tie means the same number, and treating
      // near-misses as ties would let pubRank quietly outrank a genuine score difference.
      union.sort((a, b) => (primary(b) - primary(a)) || (pubRank(a.publication_type) - pubRank(b.publication_type)));
      authorityApplied = true;
    }

    merged = union.slice(0, matchCount);
    merged._rerankApplied = rerankApplied;
    merged._metadataFilterApplied = metadataFilterApplied;
    merged._authorityApplied = authorityApplied;
    merged._dropped = dropped;
    merged._unionBeforeFilter = unionBeforeFilter;
    merged._rerankScored = rerankScored;
    merged._rerankUnscored = rerankUnscored;
  } catch (err) {
    return jsonError(502, "retrieval_failed", "Failed to retrieve chunks: " + err.message, origin);
  }

  return jsonOK({
    query, queries, count: merged.length,
    rerank_requested: body.rerank === true,
    rerank_applied: !!merged._rerankApplied,   // NEVER infer this from the request — a rerank that threw
                                               // must not be reported as one that ran
    metadata_filter_requested: body.metadata_filter === true,
    metadata_filter_applied: !!merged._metadataFilterApplied,
    authority_tiebreak_requested: body.authority_tiebreak === true,
    authority_tiebreak_applied: !!merged._authorityApplied,
    // Every exclusion is reported with its reason. A filter that quietly removes sources is
    // indistinguishable from a corpus that never had them. (2026-07-28)
    dropped_by_metadata: merged._dropped || [],
    // An explicit signal so the caller never has to infer "no evidence" from an empty array — and so a
    // talk built with no local grounding can say so rather than implying it had some.
    // TWO DIFFERENT ZEROES, AND THEY MEAN OPPOSITE THINGS (2026-07-29 audit).
    // This used to be `filterApplied && length === 0`, which reads "every candidate was positively
    // classified as non-evidence" — a strong, actionable claim. But retrieval returning nothing in the
    // first place (bad embedding, min_similarity too high, topic absent from the corpus) produced the
    // identical flag: the filter loop never executes, dropped is [], and the caller is told the corpus
    // rejected everything when in fact it offered nothing. Require that there was something to reject.
    no_eligible_local_sources: !!merged._metadataFilterApplied
                               && merged.length === 0
                               && (merged._unionBeforeFilter || 0) > 0,
    // Distinguishable from the above rather than collapsed into it.
    no_local_candidates: merged.length === 0 && (merged._unionBeforeFilter || 0) === 0,
    // Rerank COVERAGE, in the response rather than in a console.warn the caller cannot see. If scored is
    // far below the candidate count, the ordering is mostly fallback and the flag alone would not say so.
    rerank_scored: merged._rerankScored,
    rerank_unscored: merged._rerankUnscored,
    chunks: merged,
  }, origin);
}

async function handleImageGeneration(request, env, ctx, origin) {
  if (!env.OPENAI_API_KEY)
    return jsonError(503, "openai_not_configured", "OpenAI image generation is not configured on this proxy.", origin);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = dailyLimit(env);
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

  // ── UNAUTHENTICATED IMAGE GENERATION SPENT THE OPENAI KEY WITH NO WORKING LIMIT ──────────────────
  // (Codex, 2026-07-29 — CRITICAL, and my own omission: I metered the sibling hole on /v1/messages the
  // same day and did not check whether this endpoint had it too. It did.)
  //
  // Without X-Supabase-Auth, isFreeTier is false, so the cap check, the quota consume and the ledger
  // write above are ALL skipped — yet the request still runs on env.OPENAI_API_KEY below. The only
  // remaining guard was the per-IP daily counter, and RATE_LIMIT_KV is not bound in wrangler.toml, so
  // readDailyCount returns 0 forever and incrementDailyCount is a no-op. Origin is checked, but Origin
  // is client-supplied and trivially set by any non-browser client.
  //
  // Net effect before this: unlimited high-quality image generation on Jenni's key, uncapped and absent
  // from spend_ledger. At the 8c flat rate booked below, a few thousand requests is real money.
  //
  // Same remedy as the legacy /v1/messages path, for the same reason: cap and meter rather than close.
  // Closing it would break any caller I have not found, and I have been wrong about that kind of claim
  // before. Metering is strictly additive and makes the spend visible immediately.
  const anonMonthKey = monthKey || new Date().toISOString().slice(0, 7);
  if (!isFreeTier) {
    const spentCents = await getMonthlySpendCents(env, anonMonthKey);
    if (spentCents >= freeCapCents(env)) {
      return jsonError(503, "free_tier_paused",
        "Image generation is paused for this month. Add your own key to continue.",
        origin, { resumes_on: nextMonthFirstDayUTC() });
    }
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
    // Network failure — the image credit was already consumed above; refund it. (Audit fix)
    if (isFreeTier && freeUser) ctx.waitUntil(refundQuota(env, freeUser.email, "image"));
    return jsonError(502, "upstream_unreachable", "Could not reach OpenAI Images API: " + err.message, origin);
  }

  // Upstream returned an error (rate limit, bad request, etc.) — refund the consumed image credit so a
  // failed generation doesn't cost the user one of their 5. (Audit fix)
  if (!upstream.ok && isFreeTier && freeUser) ctx.waitUntil(refundQuota(env, freeUser.email, "image"));

  if (upstream.ok) {
    // LEDGER THE SPEND WHOEVER ASKED FOR IT. This used to be an if/else: free-tier requests were
    // metered, and everyone else got only incrementDailyCount — a counter backed by an unbound KV
    // namespace, so in practice nothing at all. The key is the same key either way, so the ledger entry
    // must be too, or the cap is computed from a number that omits an entire class of traffic.
    ctx.waitUntil(supaServiceRPC(env, "ledger_add", {
      p_month: anonMonthKey, p_kind: "image", p_cost_cents: IMAGE_FLAT_CENTS, p_cap_cents: freeCapCents(env),
    }).catch(() => {}));
    if (!isFreeTier) ctx.waitUntil(incrementDailyCount(env, ip));
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
  const out = await embedQueries(openaiKey, [text]);
  return out[0];
}

// Batch-embed several sub-queries in ONE OpenAI call (the embeddings API takes an array input).
// Used by query expansion: a talk covers mechanism / diagnosis / treatment / outcomes, but retrieval
// previously embedded only the bare topic string, so whole sections went ungrounded. (Jenni 2026-07-10)
async function embedQueries(openaiKey, texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  // Preserve request order — the API returns an `index` on each item.
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
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

// EXACT scoring for a KNOWN candidate set — see supabase/migrations/add_score_candidate_chunks.sql.
// Distinct from callMatchChunks, which ranks the whole table and returns a global top-N. That difference
// is the entire point: a facet-discovered niche paper outside the bare topic's global top-N must still
// receive a real score. (Codex, 2026-07-28)
async function callScoreCandidateChunks(env, queryEmbedding, chunkIds) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/score_candidate_chunks`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    // Boost weights are NOT sent: the function's defaults are pinned to canonical match_chunks and
    // test_ranking_formula.mjs fails if they drift. Sending them from here would create a second place
    // for them to disagree with production.
    body: JSON.stringify({ query_embedding: queryEmbedding, candidate_chunk_ids: chunkIds }),
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
  // Align with MAX_REQUEST_BYTES so an uploaded reference (up to 3.5 MB/file) that Claude accepts isn't
  // rejected only for ChatGPT. (Codex bug #4)
  if (raw.length > MAX_REQUEST_BYTES)
    return jsonError(413, "request_too_large", "Request body too large — try a smaller reference file.", origin);
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
async function callAnthropicText(env, sys, content, maxTok, models, tools, onProgress) {
  // Enforce the same allowlist + token cap as the synchronous /v1/messages path — a tampered client
  // can't push us onto an off-list or oversized model via the async route.
  // FAIL CLOSED (Codex 2026-07-26). This function is the generation runner — it writes both the draft and
  // the critique, and a critique that returns a corrected talk has rewritten what the reader sees. So it
  // accepts ONLY benchmark-cleared writer ids.
  // The previous version filtered against the broad ALLOWED_MODELS and then, if nothing survived,
  // SUBSTITUTED a hardcoded chain of ["claude-opus-4-8", "claude-sonnet-4-20250514",
  // "claude-haiku-4-5-20251001"] — all unverified, one of them retired on the first-party API. That
  // silently defeated the client-side writer restriction: refuse-to-write became write-with-anything.
  // Now an empty list is an ERROR the client surfaces honestly.
  const requested = (Array.isArray(models) ? models : []).slice();
  models = requested.filter(function(m){ return WRITER_CLEARED.indexOf(m) >= 0; });
  if (!models.length) {
    const err = new Error("no_cleared_writer");
    err.userMessage = "The verified writing model is temporarily unavailable. Chalk Talk only writes talks "
      + "with a model that has passed its medical-accuracy benchmark, so rather than hand you an "
      + "unverified draft it's better to wait — please try again in a few minutes.";
    console.warn("Generation refused: none of [" + requested.join(", ") + "] is a benchmark-cleared writer. "
      + "Cleared: [" + WRITER_CLEARED.join(", ") + "]");
    throw err;
  }
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
    // Stream ONLY when a progress callback is supplied (the async draft path) — lets the server surface a
    // live partial draft to the polling client so mobile users watch the talk build. (Jenni 2026-07-10)
    if (onProgress) reqBody.stream = true;
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(reqBody),
      });
    } catch (e) { lastErr = e; continue; }
    if (r.ok) {
      if (onProgress && r.body) {
        // Parse the SSE stream: accumulate text_delta content, report throttled progress, capture usage.
        let text = "", usage = {}, webSearched = false;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "", lastEmit = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (line.indexOf("data:") !== 0) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let ev; try { ev = JSON.parse(payload); } catch (_) { continue; }
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") { text += ev.delta.text || ""; }
            else if (ev.type === "message_start" && ev.message && ev.message.usage) { usage = Object.assign({}, ev.message.usage); }
            else if (ev.type === "message_delta" && ev.usage) { usage = Object.assign(usage, ev.usage); }
            // Web-search HONESTY (Jenni 2026-07): flag ONLY when Claude actually ran a search, so the client
            // can show the "Searched current sources" chip on the async/free-Claude path too.
            else if (ev.type === "content_block_start" && ev.content_block) {
              const cbt = ev.content_block.type;
              if (cbt === "web_search_tool_result" || (cbt === "server_tool_use" && ev.content_block.name === "web_search")) webSearched = true;
            }
          }
          const now = Date.now();
          if (now - lastEmit > 1200) { lastEmit = now; try { await onProgress(text); } catch (_) {} }
        }
        try { await onProgress(text); } catch (_) {}
        return { text, modelUsed: models[i], usage, webSearched };
      }
      const d = await r.json();
      // Concatenate ALL text blocks — with web_search the response also carries tool_use / tool_result
      // blocks, and the talk JSON can be split across multiple text blocks. (index.html does the same.)
      let text = "", webSearched = false;
      for (const b of (d.content || [])) {
        if (b && b.type === "text" && b.text) text += b.text;
        else if (b && (b.type === "web_search_tool_result" || (b.type === "server_tool_use" && b.name === "web_search"))) webSearched = true;
      }
      return { text, modelUsed: models[i], usage: d.usage || {}, webSearched };
    }
    if ((r.status === 529 || r.status >= 500) && i < models.length - 1) { lastErr = new Error("overloaded " + r.status); continue; }
    let em = ""; try { em = (await r.json()).error?.message || ""; } catch (_) {}
    throw new Error("Anthropic " + r.status + (em ? ": " + em : ""));
  }
  throw lastErr || new Error("Anthropic call failed");
}

async function runGeneration(jobId, body, env) {
  const t0 = Date.now();
  // Refund the reserved talk AT MOST ONCE across all failure paths — several of them can chain (e.g.
  // empty-draft refunds, then its updateJob throws into the catch which would refund again). (Codex fix)
  let _refunded = false;
  async function refundOnce() { if (_refunded) return; _refunded = true; await refundQuotaTalk(env, body.userEmail); }
  async function updateJob(patch) {
    let cur = {};
    try { cur = JSON.parse((await env.JOBS_KV.get("job:" + jobId)) || "{}"); } catch (_) {}
    if (cur.cancelled) return false;
    await env.JOBS_KV.put("job:" + jobId, JSON.stringify(Object.assign({}, cur, patch, { updatedAt: new Date().toISOString() })), { expirationTtl: 600 });
    return true;
  }
  // Quota model: 1 talk is RESERVED atomically at submit (handleGenerateAsync), which both enforces the
  // quota and prevents parallel jobs from over-running it. Here we only REFUND that reservation if the
  // job never produces a talk (cancel or error) — so a closed-tab success still charges exactly once,
  // and a failure charges zero.
  try {
    const d = body.draft || {};
    if (!(await updateJob({ stage: "drafting" }))) { await refundOnce(); return; }
    // Stream the draft: write the growing partial text to KV (throttled, skip no-growth ticks e.g. during
    // web_search) so the polling client can render the live "watch it build" preview. (Jenni 2026-07-10)
    let _lastLen = 0;
    const draft = await callAnthropicText(env, d.sys, d.content, d.maxTok || 16384, d.models, d.tools, async function (partial) {
      if (!partial || partial.length <= _lastLen + 40) return;   // only write on meaningful growth
      _lastLen = partial.length;
      await updateJob({ partialDraft: partial.slice(0, 24000) });
    });
    // Empty/failed draft: mark it an error and refund — otherwise we'd write "done" with no talk and
    // still keep the reserved credit (charge for nothing). (Audit fix)
    if (!draft || !draft.text || !draft.text.trim()) {
      await refundOnce();
      await updateJob({ status: "error", error: { code: "empty_draft", message: "The model returned an empty draft. Please try again." } });
      return;
    }
    let critText = "", critUsage = null, critModel = null;
    if (body.critique && body.critique.sys) {
      if (!(await updateJob({ stage: "critique" }))) { await refundOnce(); return; }
      const critInput = (body.critique.prefix || "") + "\n\nDraft chalk talk to review:\n" + draft.text;
      const crit = await callAnthropicText(env, body.critique.sys, [{ type: "text", text: critInput }], body.critique.maxTok || 16384, body.critique.models);
      critText = crit.text; critUsage = crit.usage; critModel = crit.modelUsed;
    }
    // Final cancel check before we finalize — a cancel that landed during critique refunds + bails.
    let curFinal = {};
    try { curFinal = JSON.parse((await env.JOBS_KV.get("job:" + jobId)) || "{}"); } catch (_) {}
    if (curFinal.cancelled) { await refundOnce(); return; }
    // Meter real spend into the ledger (authoritative for the $/mo cap).
    try {
      const monthKey = new Date().toISOString().slice(0, 7);
      let cents = estimateCostCents(draft.modelUsed, draft.usage || {});
      if (critUsage) cents += estimateCostCents(critModel, critUsage);
      if (cents > 0) await supaServiceRPC(env, "ledger_add", { p_month: monthKey, p_kind: "talk", p_cost_cents: cents, p_cap_cents: freeCapCents(env) });
    } catch (_) {}
    // updateJob returns false if a cancel landed between the final check and this write — in that race
    // the result is discarded, so refund the reservation too.
    const wrote = await updateJob({ status: "done", result: { draftText: draft.text, critText: critText, modelUsed: draft.modelUsed, critModelUsed: critModel || "", webSearched: !!draft.webSearched }, elapsedSec: Math.round((Date.now() - t0) / 1000) });
    if (!wrote) await refundOnce();
  } catch (err) {
    await refundOnce();   // job failed — don't burn the reserved talk (no-op if already refunded)
    const msg = (err && err.message) || "Generation failed";
    const code = /overload|529|5\d\d/.test(msg) ? "upstream_overloaded" : "gen_error";
    try { await updateJob({ status: "error", error: { code, message: msg } }); } catch (_) {}
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
  const raw = await request.text();
  // Match the sync /v1/messages ceiling (MAX_REQUEST_BYTES) so uploads that work synchronously can also
  // use background mode instead of falling back. (Jenni 2026-07)
  if (raw.length > MAX_REQUEST_BYTES) return jsonError(413, "request_too_large", "Request too large — try a smaller reference file.", origin);
  let body;
  try { body = JSON.parse(raw); } catch { return jsonError(400, "invalid_json", "Body is not valid JSON.", origin); }
  body.userId = user.id;
  body.userEmail = user.email || null;   // for refund-on-failure

  // Idempotency (Codex bug #2): the client sends a clientJobId so a retried / lost-response POST doesn't
  // create a second job or reserve a second talk. If a job with this id already exists, return it as-is.
  const jobId = (typeof body.clientJobId === "string" && /^[a-f0-9-]{16,64}$/i.test(body.clientJobId))
    ? body.clientJobId : crypto.randomUUID();
  try {
    const existing = await env.JOBS_KV.get("job:" + jobId);
    if (existing) {
      let ex = {}; try { ex = JSON.parse(existing); } catch (_) {}
      return jsonOK({ jobId, createdAt: ex.createdAt || new Date().toISOString(), resumed: true }, origin);
    }
  } catch (_) { /* KV read hiccup — proceed to create */ }

  // RESERVE 1 talk atomically at submit. free_tier_consume decrements only if quota remains, so N
  // parallel submits with quota=1 → only 1 succeeds; the rest get 403. This enforces the quota against a
  // tampered client AND prevents parallel-job over-run. runGeneration refunds if the job fails/cancels.
  let reserved = false;
  try { reserved = await consumeQuota(env, user.id, "talk", env); } catch (_) { reserved = false; }
  if (!reserved) return jsonError(403, "quota_exceeded", "You've used all your free talks. Add your own key to keep generating.", origin);

  // Create the job record + kick off work. If the KV write fails AFTER we reserved, refund so the talk
  // isn't leaked. (Codex bug #1)
  const now = new Date().toISOString();
  try {
    // Store userId ON the record so status/cancel can enforce owner-only access. (Security fix)
    await env.JOBS_KV.put("job:" + jobId, JSON.stringify({ status: "running", stage: "drafting", userId: user.id, createdAt: now, updatedAt: now }), { expirationTtl: 600 });
  } catch (e) {
    await refundQuotaTalk(env, body.userEmail);
    return jsonError(503, "job_create_failed", "Couldn't start background generation. Please try again.", origin);
  }
  ctx.waitUntil(runGeneration(jobId, body, env));
  return jsonOK({ jobId, createdAt: now }, origin);
}

// Owner-only: the job record holds the full talk text (and any uploaded reference content), so status +
// cancel MUST verify the caller owns the job. Without this, anyone with a jobId could read another user's
// talk or cancel their generation. (Security fix)
async function handleGenerateStatus(request, jobId, env, origin) {
  if (!env.JOBS_KV) return jsonError(503, "async_unconfigured", "Background generation isn't configured.", origin);
  const token = request.headers.get("X-Supabase-Auth");
  const user = token ? await verifySupabaseUser(env, token) : null;
  if (!user) return jsonError(401, "auth_required", "Sign in to check generation status.", origin);
  const raw = await env.JOBS_KV.get("job:" + jobId);
  if (!raw) return jsonError(404, "job_not_found", "Job expired or not found.", origin);
  let obj;
  try { obj = JSON.parse(raw); } catch { return jsonError(500, "bad_job", "Corrupt job record.", origin); }
  // STRICT owner match: require the job to have an owner AND that it's this user. An ownerless record
  // (e.g. a pre-fix legacy job) is treated as not-found rather than readable by any signed-in user.
  if (obj.userId !== user.id) return jsonError(404, "job_not_found", "Job expired or not found.", origin);

  // ── SURFACE THE ~30s waitUntil KILL INSTEAD OF SPINNING FOREVER (2026-07-29) ─────────────────────
  // runGeneration is handed to ctx.waitUntil AFTER the job id is returned, and Cloudflare terminates
  // post-response work at ~30 seconds regardless of plan. A 50–100s draft+critique is therefore killed
  // mid-flight: no `done`, no `error`, no refund — the record simply stops being updated, and the client
  // polls a job that will never change. The user watches a spinner forever and silently loses a talk.
  //
  // This does NOT fix that; the fix is durable execution (Workflows/Queues/DO — see RELEASE.md). It makes
  // the failure VISIBLE, which is the difference between a bug you can report and one you cannot.
  //
  // Read-only on purpose. It classifies, it does not mutate, and it does not refund: the runner may still
  // be alive and about to write, and racing it from a polling endpoint would risk double-refunding or
  // clobbering a real result. Diagnosis here, remediation where the state is owned.
  const STALL_AFTER_MS = 90_000;
  if (obj.status === "running" || obj.status === "critique") {
    const last = Date.parse(obj.updatedAt || obj.createdAt || "");
    const idleMs = Number.isFinite(last) ? Date.now() - last : 0;
    if (idleMs > STALL_AFTER_MS) {
      return jsonOK(Object.assign({}, obj, {
        stalled: true,
        idle_seconds: Math.round(idleMs / 1000),
        stall_reason: "no_progress",
        stall_detail: "Background generation has not progressed for " + Math.round(idleMs / 1000)
          + "s. Cloudflare terminates post-response work at ~30s, so this job was most likely killed "
          + "mid-generation and will never finish. Your talk credit was reserved and not refunded — "
          + "this is a known defect in the background path, not something you did.",
      }), origin);
    }
  }
  return jsonOK(obj, origin);
}

// CANCEL MUST NOT CLAIM AN OUTCOME IT DID NOT ACHIEVE (Codex, 2026-07-29).
// This used to wrap the whole thing in `catch (_) {}` and return {status:"cancelled"} unconditionally.
// If the KV write failed, the job was never marked cancelled: generation continued, completed, and was
// billed — while the UI said "cancelled" and the user reasonably stopped worrying about it. That is the
// swallow-the-error-and-report-success pattern in its most expensive form, because the user's whole
// reason for pressing cancel is to stop spending.
//
// Now: the write is verified by reading it back, and a failure returns 502 with cancelled:false so the
// client can retry or warn. A cancel that did not happen is not a cancel.
async function handleGenerateCancel(request, jobId, env, origin) {
  // No job store means nothing is running server-side, so there is genuinely nothing to cancel — that
  // is a true "cancelled", not a swallowed failure.
  if (!env.JOBS_KV) return jsonOK({ status: "cancelled", cancelled: true, note: "no server-side job store" }, origin);
  const token = request.headers.get("X-Supabase-Auth");
  const user = token ? await verifySupabaseUser(env, token) : null;
  if (!user) return jsonError(401, "auth_required", "Sign in to cancel generation.", origin);

  let raw;
  try {
    raw = await env.JOBS_KV.get("job:" + jobId);
  } catch (err) {
    return jsonError(502, "cancel_failed",
      "Could not reach the job store to cancel this generation. It may still be running — try again.",
      origin, { cancelled: false, reason: "kv_read_failed" });
  }
  if (!raw) return jsonOK({ status: "cancelled", cancelled: true, note: "no such job" }, origin);

  let cur; try { cur = JSON.parse(raw); } catch { return jsonError(500, "bad_job", "Corrupt job record.", origin); }
  if (cur.userId !== user.id) return jsonError(404, "job_not_found", "Job expired or not found.", origin);

  cur.cancelled = true;
  if (cur.status !== "done") cur.status = "cancelled";
  cur.updatedAt = new Date().toISOString();
  try {
    await env.JOBS_KV.put("job:" + jobId, JSON.stringify(cur), { expirationTtl: 600 });
  } catch (err) {
    return jsonError(502, "cancel_failed",
      "Could not record the cancellation. The generation may still be running and may still be billed.",
      origin, { cancelled: false, reason: "kv_write_failed" });
  }
  // READ BACK. A KV put that resolves without throwing has still not necessarily produced a record the
  // runner will observe, and the runner is what decides whether to stop. Confirm the flag is actually
  // there before telling the user it is. (Note: KV is eventually consistent, so this is a best-effort
  // confirmation, not a guarantee — hence the honest `cancelled` field rather than a bare status string.)
  try {
    const back = await env.JOBS_KV.get("job:" + jobId);
    const okFlag = back ? (JSON.parse(back).cancelled === true) : false;
    if (!okFlag) {
      return jsonError(502, "cancel_failed",
        "The cancellation did not stick. The generation may still be running — try again.",
        origin, { cancelled: false, reason: "readback_mismatch" });
    }
  } catch (_) { /* read-back is advisory; the write above already succeeded */ }
  return jsonOK({ status: "cancelled", cancelled: true }, origin);
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

  // Return only public-safe fields: NO email, institution, handle, or other profile PII. We DO include
  // the author's display name (only for a talk they chose to make public) and their pseudonymous
  // user_id as author_user_id — the latter is required so a viewer can detect "this is my own talk"
  // (to hide Save-copy) and so the save-copy flow can stamp source_curator_user_id for attribution.
  // A Supabase user UUID is an opaque pseudonymous identifier, not sensitive PII. (Codex clarification)
  const payload = {
    id: row.id,
    title: row.title,
    topic: row.topic,
    style: row.style,
    depth: row.depth,
    talk_json: row.talk_json,
    created_at: row.created_at,
    author: authorName ? { name: authorName } : null,
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
