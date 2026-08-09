import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
let assertions = 0;
function check(value, message){
  assertions++;
  if(!value) throw new Error(message);
}

function functionSource(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escape = false;
  for(let i=open; i<src.length; i++){
    const ch = src[i];
    if(quote){
      if(escape) escape = false;
      else if(ch === "\\") escape = true;
      else if(ch === quote) quote = null;
      continue;
    }
    if(ch === '"' || ch === "'" || ch === "`"){ quote = ch; continue; }
    if(ch === "{") depth++;
    else if(ch === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

// Device-safe viewport and keyboard behavior.
check(/name="viewport"[^>]+viewport-fit=cover/.test(code), "viewport must expose safe-area insets");
check(/\.composer-bubble\{bottom:calc\(12px \+ var\(--kb, 0px\)\)/.test(code), "mobile composer must follow measured keyboard inset");
check(/input\[type="password"\][\s\S]{0,180}select, textarea \{ font-size: 16px !important; \}/.test(code), "all mobile modal inputs must suppress iOS focus zoom");

// Primary mobile controls meet the 44px target without depending on their visible glyph size.
check(/\.tk-bottomnav button\{min-height:48px\}/.test(code), "bottom navigation targets must be at least 48px high");
check(/\.drawer-head \.drawer-close\{[^}]*width:44px;height:44px/.test(code), "drawer close target must be 44x44");
check(/\.composer-bubble \.cp-close,\.composer-bubble \.send-btn\{width:44px;height:44px;min-width:44px\}/.test(code), "refine close/send targets must be 44x44");
check(/#myLibBtn,details\.howit > summary\{min-height:44px !important\}/.test(code), "Library and onboarding triggers must be 44px high");

// Library is a real modal dialog, not only a visually positioned div.
check(/id="myLibBtn" aria-haspopup="dialog" aria-controls="mobileLibDrawer" aria-expanded=/.test(code), "Library opener must expose dialog state");
check(/id="mobileLibDrawer" role="dialog" aria-modal="true" aria-labelledby="mobileLibTitle" tabindex="-1"/.test(code), "Library drawer must expose modal semantics");
check(/body\.mobile-drawer-open\{overflow:hidden;touch-action:none\}/.test(code), "open drawer must lock background scrolling");
check(/padding-top:env\(safe-area-inset-top\);padding-bottom:env\(safe-area-inset-bottom\)/.test(code), "drawer must respect top and bottom safe areas");

// Exercise the single close transaction: state, render, and focus restoration.
const closeSource = functionSource("closeMobileLibraryDrawer");
let renderCount = 0;
let focusCount = 0;
const ctx = {
  S: { mobileLibOpen: true },
  render(){ renderCount++; },
  setTimeout(fn){ fn(); },
  document: { getElementById(id){ return id === "myLibBtn" ? { focus(){ focusCount++; } } : null; } }
};
vm.createContext(ctx);
vm.runInContext(`${closeSource}; this.closeMobileLibraryDrawer = closeMobileLibraryDrawer;`, ctx);
check(ctx.closeMobileLibraryDrawer() === true, "open drawer should report that it closed");
check(ctx.S.mobileLibOpen === false, "close must clear drawer state");
check(renderCount === 1, "close must render exactly once");
check(focusCount === 1, "close must restore focus to Library opener");
check(ctx.closeMobileLibraryDrawer() === false && renderCount === 1, "closing an already closed drawer must be a no-op");

// Loading progress is perceivable without announcing the changing timer every second.
check(/role="progressbar" aria-label="Talk generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=/.test(code), "generation bar must expose numeric progress semantics");
check(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*animation-duration:\.01ms !important/.test(code), "reduced-motion preference must stop continuous UI animation");

console.log(`test_mobile_ux: ${assertions} assertions passed`);
