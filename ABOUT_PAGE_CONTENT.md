# About Chalk Talk

A teaching tool by Jennifer Tang, MD — Internal Medicine / Nephrology resident at NYU Langone. Free for educational use.

Chalk Talk turns a topic into a 10-minute teaching outline grounded in current society guidelines and landmark trials. It is designed for residents teaching residents — short, structured, and evidence-cited.

This page explains how the app handles your work, what gets shared and what stays yours, how copying others' talks works, and the copyright posture behind it all.

---

## How it works (the short version)

1. You type a topic (e.g. "DKA management" or "HFrEF GDMT").
2. The app retrieves matching evidence — landmark trials, recent reviews, and society guidelines — from PubMed via embedding search.
3. Claude drafts a structured talk with inline `[N]` citations grounding every clinical fact. Optionally cross-checks the open web (allowlisted medical domains).
4. A second model peer-reviews the draft for factual errors, outdated recommendations, contradictions, and drug-name spelling.
5. You get a 5- to 10-minute outline with the PMIDs / DOIs that ground each fact.

You can edit any section inline, refine with follow-up prompts ("Ask to revise lesson"), upload your own references to shape the talk, or regenerate. All of this is local to your library unless you choose to share.

---

## Your privacy

**What stays private — always.**

- Your unsaved talks (anything in the compose form, anything pre-Save) never leave your browser except through the LLM call to generate them.
- Your library is private by default. Saving a talk puts it in `is_public = false` state. No one else can see it. Not even other curators.
- Uploaded references (PDFs, slides, notes — anything you drag into the references dropzone) are sent to the LLM only as context for that one generation. They are stored on the talk row in your library under `refine_context` but only readable by you.
- Refine prompts (your "Ask to revise lesson" follow-ups) are stored alongside your talk in `refine_context` for the same single generation, then live in your private library.

**What stays private when you share.**

When you publish a talk (any sharing tier), the database trigger automatically scrubs:

- `refine_context` is set to `NULL` — your uploaded references, refine prompts, and private notes are stripped from the row before anyone else can read it.
- Refer to the scrub trigger in `supabase/migrations/add_sharing_scrub.sql` if you want to verify the code.

**What gets shared when you share.**

- The talk content itself: title, subtitle, sections, teaching pearls, board tips, takeaways, references, citation list.
- AI-generated visual aids (`savedVisuals[].imgB64`) — these are images you generated within the talk, which OpenAI / Anthropic / Google grant you ownership of per their terms. They travel with the talk so viewers see the full content.
- Your display name from your profile (shown as author).
- That's it.

**What we do NOT do.**

- No third-party analytics, no Google Analytics, no Mixpanel, no Segment.
- No email tracking, no read receipts on shared talks.
- No selling of any data to anyone, ever.
- No training the LLM on your private library. (The LLM provider's terms determine whether prompts are used for training. Anthropic's terms as of writing do not use API traffic for training by default.)
- No indexing of your shared talks by search engines. Every share viewer and profile page sends `<meta name="robots" content="noindex">`.

---

## The three sharing tiers

Every saved talk lives in exactly one of three states. You choose. You can change anytime.

**🔒 Just me** — Default. Private, in your library only. No one else can see it.

**🔗 People I send the link to** — The talk gets a private URL (`/share/<token>`). Anyone with the URL can view. The talk does **not** appear on any profile page, in any listing, or anywhere discoverable. You DM the URL to whoever you want, manually. They can DM it onward. Each share is intentional and direct.

**⭐ Anyone who finds my profile** — The talk is featured on the curator's public profile page. Anyone who has the curator's profile URL can browse all their featured talks. Currently this is `chalk-talk/#showcase` for Jennifer Tang, MD; multi-curator profiles at `/u/<handle>` are coming.

**Downgrading collapses cleanly.** Going from any public tier to "Just me" both unfeatures (if applicable) and invalidates the share URL. Existing links stop working. If you want link-only sharing again later, re-publish via the same modal — the same `share_token` reactivates, so prior DMs work again. (This is intentional. If you want a clean break, contact us and we'll rotate the token.)

---

## Saving copies of others' talks

When you read someone else's public talk and click **★ Save copy**, here's exactly what happens:

**What gets copied:**

- The full talk content (sections, pearls, tips, takeaways, references, citations)
- AI-generated visual aids (`savedVisuals[].imgB64`) — they belong to the talk, they travel with it
- The title and subtitle

**What does NOT get copied:**

- The original author's uploaded references (PDFs, MKSAP excerpts, notes) — these were scrubbed at publish time and never existed on the published row in the first place
- The original author's refine prompts — same; never present on public rows
- Source file metadata (`files_meta`) — set to empty on copy

**What gets stamped on the copy for attribution:**

- `source_id` — pointer to the original talk row
- `source_curator_user_id` — the original author's user_id
- `source_curator_name` — the original author's display name, denormalized so it survives even if they ever delete their profile

**What happens to the copy:**

- It is fully yours. You own it. You can rename, edit, refine, delete, re-feature on your own profile, anything.
- It is private by default (`is_public = false`, `is_featured = false`). You decide later whether to publish it.
- Your edits do not affect the original. The original author's later edits do not propagate to your copy. The copy is a snapshot taken at the moment you clicked Save copy.
- The "📥 From: [author]" attribution chip stays on the card in your library and follows the copy if you ever re-publish it. Provenance is preserved.

**If the original is deleted:**

- Your copy survives. The `source_id` pointer becomes `NULL` (via `ON DELETE SET NULL`).
- The `source_curator_name` chip stays so attribution doesn't disappear.

---

## Copyright posture

Chalk Talk takes a conservative posture grounded in fair use for educational purposes.

**Your uploaded references (PDFs, MKSAP, society guidelines, journal articles).**

These are likely copyrighted material that you are entitled to read under your subscriptions or fair use. The app uses them only as input to shape the LLM's generation for your one talk. They are stored in your private library (under `refine_context`) but never published, never shared, and stripped automatically when you make a talk public. You retain whatever rights you had before uploading.

**Society guideline summaries (the in-app GUIDELINES database).**

The app includes hand-curated factual restatements of recommendations from major society guidelines (KDIGO, AHA/ACC, ADA, IDSA, ATS, ASH, ASCO, ACR, AAN, KDIGO, USPSTF, AASLD, ACG, AAP, NICE, CDC, WHO, and others). These are short factual statements like "KDIGO 2024 recommends ACEi/ARB for proteinuria with eGFR > 25." Restating a guideline recommendation as a fact is not copyright infringement — facts cannot be copyrighted. The summaries cite the originating society and link to the official publication for definitive reference.

**Citations and references (`[N]` chips throughout the talk).**

Every clinical fact in a generated talk is cited inline. Citation chips link to the originating source — PubMed, society guideline portals, journal pages. The app does **not** host paywalled full-text. You follow the link and use your institutional or personal subscription to read the source.

**Talk content generated by the LLM.**

You own the outputs of LLM generation per the provider's terms (Anthropic, OpenAI). Outputs are derivative of the model's training data and your prompt, and the providers grant you full ownership and usage rights of the outputs.

**AI-generated visual aids.**

The visual aid generator uses OpenAI gpt-image-1.5 or Google Gemini nano-banana-pro. Per those providers' terms, you own the outputs. Saved visuals (`imgB64`) travel with the talk on save-copy because they are part of the content you generated.

**Save-to-my-library copies.**

When User A's featured talk is saved-copy by User B, User B receives a license to use the talk content for their own educational purposes. Attribution to User A is preserved automatically via the `source_curator_name` chip. This mirrors academic norms of citation and credit. User A's published talk is, by virtue of having been featured on a public profile, offered as an educational resource — saving a copy and adapting it is exactly the intended workflow.

**Boards-style practice questions.**

Generated board questions are original derivative compositions written by the LLM in the style of UWorld / MKSAP / ABIM exams. They are not copied from those question banks. They are intended for self-study and teaching, not for resale or redistribution as a competing product.

**You cannot share content that infringes third-party copyright.**

If you upload a PDF of a copyrighted source and ask the LLM to reproduce it verbatim, that is not okay and we cannot detect every such case. The app's design discourages this — uploads are used as context for generating original talks, and the published output is scrubbed of the source uploads. But ultimate responsibility for not infringing third-party copyright sits with you as the user. If you receive a takedown notice or copyright complaint regarding a talk you published, the talk will be made private and you will be contacted.

---

## Important caveats (read these)

Chalk Talk is a **teaching tool**, not a clinical decision-support tool. It is not a substitute for primary literature, peer-reviewed guidelines, your attending, your institutional protocols, or your own clinical judgment.

- Large language models can hallucinate. The app uses a second-model critique pass to catch errors, but does not catch everything. Verify clinical claims against primary sources before using them in patient care.
- Society guidelines evolve. A talk generated in 2026 may cite guidelines that have been superseded by 2028. Always check the publication date on the source.
- Drug names occasionally get garbled by LLMs. The app includes spelling guards but slip-throughs happen. Verify drug names against UpToDate, Epocrates, or the FDA label before prescribing.
- ABIM blueprint mappings are best-effort. Use the actual ABIM exam blueprint for definitive coverage planning.

If you spot an error in a talk, edit it inline (the ✎ pencil). If you spot an error in a publicly-shared talk that you did not author, contact the author.

---

## Your data, your library

You own your library. To export everything you've created:

- **Per talk**: ⋮ menu → Export PDF, Save as image, Export JSON.
- **Whole library**: Account menu → Export library JSON. You get a single file with every saved talk, including refine context and uploaded reference metadata.
- **Delete account**: Account menu → Delete my account. Your auth row is deleted, your profile row is deleted, and every talk row owned by you is deleted. Public links you created return 404. Copies others made of your public talks survive (with the attribution chip becoming "From: [your name]" even after your profile is gone — the name is denormalized for exactly this case).

---

## Contact

Built and maintained by Jennifer Tang, MD. Reach her on [LinkedIn](https://www.linkedin.com/in/tangjennii/).

This is a personal educational project, not affiliated with NYU Langone, any pharmaceutical company, or any guideline society. No conflicts of interest. No paid promotions. No advertising.

---

*Last updated: 2026-06-08.*
