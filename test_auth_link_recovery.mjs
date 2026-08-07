// FAILED SIGN-IN / RESET LINKS — run: node test_auth_link_recovery.mjs
//
// Every emailed auth link can come back dead: expired, already used, or opened in a browser that never
// held the PKCE verifier. Supabase signals that with error params on the redirect, and the SDK swallows
// them — detectSessionInUrl strips the URL and resolves with no session, so the app rendered its ordinary
// signed-out page and the user was left with nothing to act on.
//
// The reset path was worse than silent. redirectTo ends in "#recovery", so an EXPIRED reset link still
// matched the /recovery/ test at boot and opened "Set a new password" with no session behind it: the user
// chose a password, submitted, and updateUser failed on a session that had never been established.
//
// Also covered: "Continue with Google" has to be reachable from every mode where signing in is the point.
// Two of the three accounts that exist have only ever used Google, and Generate opens "signup" directly.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const fn = (name) => {
  let i = code.indexOf("async function " + name + "(");
  if (i < 0) i = code.indexOf("function " + name + "(");
  if (i < 0) throw new Error("not found: " + name);
  let depth = 0;
  for (let j = code.indexOf("{", i); j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}") { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  throw new Error("unbalanced: " + name);
};

// ── 1 · THE PARAMS ARE READ AT ALL ───────────────────────────────────────────
const read = fn("_readAuthErrorFromUrl");
ok(/location\.search/.test(read) && /location\.hash/.test(read),
   "both carriers are scanned — PKCE puts the error in the query, implicit puts it in the hash");
ok(/error_code/.test(read) && /error_description/.test(read),
   "the code and the description are both captured, not just the bare error flag");

// ── 2 · READ BEFORE THE SDK CAN STRIP THEM ───────────────────────────────────
const bootRead = code.indexOf("_ctAuthReturn.err = _readAuthErrorFromUrl();");
const bootRecovery = code.indexOf('S.authMode = "newpassword"');
ok(bootRead > 0, "the boot sequence reads the params");
ok(bootRead < bootRecovery,
   "…before deciding whether this is a recovery landing, since that decision depends on them");

// ── 3 · AN EXPIRED RESET LINK MUST NOT OPEN THE SET-PASSWORD FORM ────────────
ok(/_ctAuthReturn\.wantedRecovery && !_ctAuthReturn\.err/.test(code),
   "the set-a-new-password form opens only when the recovery link came back clean");
const handle = fn("handleAuthReturn");
ok(/wantedRecovery \? "reset"/.test(handle),
   "a dead reset link lands on the reset form — the one screen that can still fix it");
ok(/wantedRecovery && !hasSession/.test(handle),
   "…and so does a recovery landing that produced no session, even with no error param");

// ── 4 · THE MESSAGES NAME A CAUSE THE USER CAN ACT ON ────────────────────────
const msg = fn("authLinkErrorMessage");
ok(/otp_expired/.test(msg) && /expired/i.test(msg), "an expired link is called expired");
ok(/verifier|pkce/.test(msg) && /different browser/i.test(msg),
   "a verifier mismatch says the link was opened in the wrong browser");
ok(/access_denied/.test(msg) && /already have been used|already been used/i.test(msg),
   "a consumed link says it was already used");
ok(/e&&e\.desc|e\.desc/.test(msg),
   "an unrecognised failure passes Supabase's own words through rather than inventing a cause");

// ── 5 · IT STILL FIRES WHEN THE SDK NEVER LOADS ──────────────────────────────
ok(/!window\.sbReady\) handleAuthReturn\(false\)/.test(code),
   "a blocked or offline SDK still produces an explanation instead of a silent signed-out page");
ok(/if\(_ctAuthReturn\.settled\) return;/.test(handle),
   "…and the fallback cannot double-fire over the SDK's own result");

// ── 6 · THE URL IS CLEANED WITHOUT EATING DEEP LINKS ─────────────────────────
const clear = fn("_clearAuthErrorFromUrl");
ok(/searchParams\.delete/.test(clear) && /hp\.delete/.test(clear),
   "the error keys are removed from both the query and the hash");
ok(/url\.hash = rest \? "#"\+rest : ""/.test(clear),
   "…leaving any other fragment intact, so #t=/#u//#share/ deep links survive a failed link");

// ── 7 · GOOGLE IS REACHABLE WHEREVER SIGNING IN IS THE POINT ─────────────────
const panel = fn("authPanelHTML");
const block = panel.split('else if(mode === "reset")')[0];
const choose = block.split('else if(mode === "signup")')[0];
const signup = block.split('else if(mode === "signup")')[1].split('else if(mode === "signin")')[0];
const signin = block.split('else if(mode === "signin")')[1];
ok(/_authGoogleBlock\(\)/.test(choose), "the chooser offers Google");
ok(/_authGoogleBlock\(\)/.test(signup),
   "so does Create account — Generate opens it directly, and a returning Google user starts there");
ok(/_authGoogleBlock\(\)/.test(signin), "so does Sign in");
ok((code.match(/id="googleSignInBtn"/g) || []).length === 1,
   "…all from one piece of markup, so the button cannot drift between modes");

console.log("\n" + (failures === 0 ? "✔ LINK RECOVERY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
