// AUTHENTICATION FLOW — run: node test_auth_flow.mjs
//
// The old panel showed "Continue with Google" and one email field under the heading "Sign in or sign up".
// A new user could not tell which of the two was about to happen, there was no password, no reset, and no
// state acknowledging that a link had been sent — so people pressed the button again. It was also rendered
// from TWO near-identical copies of the markup that had already drifted apart in font size and wording.
//
// These assertions cover the states and the safety properties. Password handling is entirely Supabase's;
// what is checked here is that nothing in this app stores, persists or logs one.
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

// ── 1 · THE STATES EXIST AND ARE DISTINCT ────────────────────────────────────
const panel = fn("authPanelHTML");
for (const mode of ["choose", "signup", "signin", "reset", "reset_sent", "verify", "newpassword"]) {
  ok(panel.includes('"' + mode + '"'), `the panel renders a distinct "${mode}" state`);
}
ok(/Create account/.test(panel) && /Sign in/.test(panel),
   "the first screen offers Create account AND Sign in as separate actions");
ok(/Forgot password\?/.test(panel), "…and the sign-in state offers Forgot password");
const title = fn("authTitle");
for (const t of ["Create your account", "Sign in", "Reset your password", "Check your email", "Set a new password"]) {
  ok(title.includes(t), `the heading changes with the mode: "${t}"`);
}

// ── 2 · SUPABASE OWNS THE CREDENTIALS ────────────────────────────────────────
ok(/sb\.auth\.signUp\(/.test(code), "sign-up uses Supabase signUp");
ok(/sb\.auth\.signInWithPassword\(/.test(code), "sign-in uses Supabase signInWithPassword");
ok(/sb\.auth\.resetPasswordForEmail\(/.test(code), "reset uses Supabase resetPasswordForEmail");
ok(/sb\.auth\.updateUser\(\{ password/.test(code), "the new password is set with Supabase updateUser");
// Nothing home-grown anywhere near a password.
ok(!/bcrypt|scrypt|sha256\(|md5\(|hashPassword|localStorage\.setItem\([^)]*[Pp]assword/.test(code),
   "no hashing, comparison or persistence of passwords is implemented here");
ok(!/console\.(log|info|warn|error)\([^)]*S\.authPassword/.test(code), "no password is ever logged");

// ── 3 · PASSWORDS DO NOT LINGER IN STATE ─────────────────────────────────────
const wiring = fn("wireAuthPanel");
ok(/S\.authPassword = ""; S\.authPassword2 = "";/.test(wiring),
   "the form clears both password fields after every submit, success or failure");
ok(/S\.authPassword = ""; S\.authPassword2 = "";/.test(fn("authSetMode")),
   "…and switching modes clears them too");
ok(/S\.authLastPassword = "";/.test(fn("closeAuth")),
   "…and closing the panel drops the copy kept for Resend");

// ── 4 · VALIDATION HAPPENS BEFORE THE SERVER IS ASKED ────────────────────────
// Scope to the SUBMIT handler. Searching the whole of wireAuthPanel found signUpWithPassword in the
// Resend handler, which is defined earlier — so the ordering check compared the mismatch guard against an
// unrelated call and failed on correct code.
const submitH = wiring.slice(wiring.indexOf("form.onsubmit"));
const iMismatch = submitH.indexOf("don't match");
const iSubmit = submitH.indexOf("signUpWithPassword(");
ok(iMismatch > 0 && iSubmit > 0 && iMismatch < iSubmit,
   `a password mismatch is caught locally, before any sign-up request (guard @${iMismatch}, call @${iSubmit})`);
ok(/p1\.length < AUTH_MIN_PASSWORD/.test(wiring), "…as is a password that is too short");

// ── 5 · THE SIGN-UP RESULT IS READ, NOT ASSUMED ──────────────────────────────
// Supabase returns a session immediately when email confirmation is off, and none when it is on. Telling
// someone to check their inbox while they are already signed in is a small lie that costs real trust.
ok(/r\.data && r\.data\.session/.test(wiring),
   "sign-up checks whether a session came back rather than always saying 'check your email'");
ok(/authSetMode\("verify"\)/.test(wiring), "…and only shows the verify state when there is no session");

// ── 6 · A RECOVERY LINK LANDS ON THE SET-PASSWORD FORM ───────────────────────
ok(/recovery/i.test(code) && /S\.authMode = "newpassword"/.test(code),
   "arriving from a reset link opens the set-a-new-password form");

// ── 7 · ONE PANEL, NOT TWO COPIES ────────────────────────────────────────────
// One render site, not two. The old second copy was unreachable (`if(false && …)`) but still had to be
// kept in step by hand, which is the cost this consolidation was meant to remove.
ok((code.match(/h \+= authPanelHTML\(\);/g) || []).length === 1,
   "the panel is rendered from exactly one place");
ok((code.match(/googleSignInBtn' /g) || []).length <= 1 &&
   (code.match(/id="googleSignInBtn"/g) || []).length <= 1,
   "the Google button markup exists in exactly one place");
// …and wired once, by the same function that renders it. A second wireAuthPanel() call ran in bindMain,
// which executes BEFORE renderGlobalModals rebuilds the markup — so it bound the previous render's nodes.
ok((code.match(/wireAuthPanel\(\);/g) || []).length === 1,
   "…and wired once, in the function that renders it");
ok(!/magicLinkForm/.test(code), "the old ambiguous magic-link form is gone");

// ── 8 · ACCESSIBILITY BASICS ─────────────────────────────────────────────────
ok(/role="status" aria-live="polite"/.test(panel), "status messages are announced to screen readers");
const field = fn("_authField");
ok(/<label for="/.test(field), "every field has a real label bound to it");
ok(/autocomplete="/.test(field) && /(new|current)-password/.test(panel),
   "password fields declare autocomplete, so password managers can fill and save them");
ok(/font-size:16px/.test(fn("_authField")), "inputs are 16px, so iOS does not zoom the viewport on focus");

console.log("\n" + (failures === 0 ? "✔ AUTH FLOW OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
