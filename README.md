# Chalk Talk

**A 10-minute teaching generator for attendings and physician educators.**

Chalk Talk is a single-page web app that produces a structured, mechanism-first chalk talk on any internal-medicine topic — anchored to current society guidelines (KDIGO, AHA/ACC, ATS, IDSA, ACG, AASLD, ADA, ACR, AAN, SCCM, ASH, ASCO/NCCN), peer-reviewed by a second model before display, and rendered with a Visual Memory Card learners can screenshot. Built to bring formal bedside teaching back into a time-starved residency.

> **Live demo:** https://tangjennii-wq.github.io/chalk-talk/

## What it does

- **Two modes** — `Lecture` (physiology-first, 3–4 sections) or `Boards` (UWorld-style vignette with five distractors and explanations)
- **Two-step accuracy pipeline** — Claude Opus 4.8 drafts the talk, then a guideline-aware Sonnet critique pass (Haiku fallback) re-derives every number, scans for internal contradictions, and corrects the talk before display
- **Guideline grounding from the first draft** — the topic is auto-mapped to the relevant society's guideline summaries AND live PubMed abstracts (vector retrieval), both injected into the very first draft — not a second pass
- **Optional web verification** — opt-in `web_search` step against PubMed / society sites
- **Reference upload** — attach PDFs, images, or text notes as source context for a specific teaching session
- **Visual aid** — pick an AI illustration (Gemini Nano Banana Pro or OpenAI gpt-image-1.5) or a no-key SVG flowchart
- **Audio podcast** — converts the talk into a 1-2 minute conversational narration
- **Visual Memory Card** — screenshot-ready 4-quadrant summary
- **Save to library** + JSON / PDF export
- **📖 Examples mode** — pre-baked sample talks across major specialties; no API key required to browse

## Quickstart

### For viewers
Just open `index.html` in a browser, or visit the live demo. Click **📖 Examples** to browse pre-generated chalk talks across nephrology, cardiology, pulmonary, GI, endo, ID, heme, rheum, and neuro — no API key needed.

### To generate fresh talks
You'll need an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys). Click **Set key** in the header. The key is stored only in your browser's `localStorage` and is sent only to Anthropic's API.

For AI illustrations, you'll also need a free Google Gemini key from [aistudio.google.com](https://aistudio.google.com/apikey). The simple-diagram option works without one.

## For developers

### Regenerating the example samples

The 10 example talks ship pre-baked in `index.html`. To regenerate them (e.g. when guidelines update):

```bash
ANTHROPIC_API_KEY=sk-ant-... node generate_samples.js
```

Requires Node 18+. The script runs the same draft → peer-review pipeline as the live app (Opus draft → Sonnet review), writes `samples.json`, and embeds the result back into `index.html` via the `// __SAMPLES_MARKER__` comment.

Useful flags:
- `--only=hyponatremia,hfref` — regenerate just specific topic slugs
- `--no-embed` — write `samples.json` only, leave `index.html` untouched
- `--dry` — print the topic queue without making API calls

The seed topic list lives at the top of `generate_samples.js` — edit `SEEDS` to change which topics are sampled.

### Reference uploads

The app accepts `.txt`, `.pdf`, `.png`, `.jpg`, and `.jpeg` files. Text files are truncated to keep requests manageable; PDFs and images are sent to the model as document/image blocks. In proxy mode, the Cloudflare Worker allows request bodies up to 5 MB so modest guideline PDFs and one-page handouts can pass through.

### Deploying

Because the app is a single HTML file with no build step, GitHub Pages is the simplest host:

1. Push to GitHub
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `/ (root)`
3. Your site is live at `https://<username>.github.io/<repo>/`

### Architecture

Full end-to-end walkthrough (state model, generation pipeline, RAG, refine, Worker, Supabase, free tier, sharing) lives in **[ARCHITECTURE.md](ARCHITECTURE.md)**. Quick map:

```
User (browser)
 ↓
index.html — single-file app, vanilla JS, no framework, no build step (GitHub Pages)
 ├─ S + render()   — one global state object; render() rebuilds the DOM from it
 ├─ GUIDELINES     — telegraphic society-guideline summaries (shipped inline)
 ├─ generate()     — Opus 4.8 draft → guideline-aware Sonnet critique → citation prune
 └─ weaveRevision()— refine = surgical JSON patch, not regeneration
 ↓                        ↓                          ↓
Cloudflare Worker    Supabase (Postgres)        Anthropic + OpenAI
(worker.js)          - auth (magic link/Google)  - Claude (draft+critique)
- holds the API key  - talks / profiles (RLS)    - gpt-image (illustrations)
- origin allowlist   - free_tier_usage,          - text-embedding (RAG)
- rate limit         -   spend_ledger
- free-tier metering - documents/chunks (RAG, pgvector)
- $250/mo spend cap
- /retrieve (RAG)
```

## License

- **Code** — [MIT](LICENSE)
- **Educational content** (prompts, guideline summaries, generated talks) — [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

## AI transparency & medical disclaimer

This application calls Anthropic's Claude API to generate chalk talks at runtime. Outputs are model-generated and may contain errors. **This tool is intended for educator-facilitated teaching contexts and is NOT a substitute for primary clinical references, peer-reviewed literature, or clinical judgment.** All clinical recommendations should be verified against original guidelines before application to patient care.

The second-model review step (a guideline-aware numeric/consistency/completeness check) reduces errors but is not a substitute for human medical review. All published talks should be verified against primary guidelines before teaching.

## Attribution

Created by [Jennifer Tang, MD](https://www.linkedin.com/in/tangjennii/) — Internal Medicine · Nephrology.

Guideline societies referenced: KDIGO, AHA/ACC/HFSA, ATS/ERS, GOLD, GINA, ACG, AASLD, ADA, Endocrine Society, IDSA, ASH, ACR, EULAR, AAN, AHA/ASA, SCCM, AAAAI/ACAAI, AAD, APA, ASAM, AGS, ACOG, NAMS, ASCO, NCCN, USPSTF, ACIP/CDC, AAHPM. Topic taxonomy informed by the [ABIM Internal Medicine Certification Examination Blueprint](https://www.abim.org/).

Trademarks belong to their respective societies.
