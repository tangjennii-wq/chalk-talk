# Server-owned generation — design

**Status: design only. Nothing built.** The residual Codex named: the browser still chooses the prompt,
the model list, the job id and the stage, and calls a generic Anthropic proxy. Receipts bound and
attribute every call; they do not make the client's *claims* trustworthy.

Written so the decision is a decision, not a default.

---

## What is actually wrong

`POST /v1/messages` is a proxy. The client sends `{model, messages, system, tools, max_tokens}` and the
Worker forwards it. Authorisation now checks *who* is calling, *which job*, *which stage*, and *which
model* — but not **what is being asked**. A tampered client with a valid talk receipt can send any prompt
it likes to a cleared model, within its stage budget.

That is bounded, metered and attributable. It is not "the server decided what to generate".

**Why it matters more here than in most apps:** the medical-content guarantee is that a Chalk Talk talk
was written by a benchmarked model *from Chalk Talk's prompts*. Half of that is currently enforced.

---

## Target shape

Replace the proxy with an operation endpoint. The client sends *intent*; the server owns everything else.

```
POST /v1/generate
  { topic, style, depth, specialty, wantWebSearch, references? }
      ↓  server validates against a strict schema
      ↓  server selects the prompt template, the model, the stage sequence
      ↓  server reserves quota and mints an internal receipt (never seen by the client)
      ↓  Workflow: draft → critique → meter → finalize
  → { jobId }
```

The client never names a model, never supplies a system prompt, never picks a stage. `X-CT-Stage` and
`X-CT-Job` disappear because there is nothing for them to assert.

### Auxiliary operations get named routes, not a general proxy

```
POST /v1/aux/podcast-script   { talkId }
POST /v1/aux/diagram-prompt   { sectionId, kind }
POST /v1/aux/chat             { talkId, question }
```

Each with a server-owned template, a strict input schema, and its own small budget. The prompt is never
client-supplied; the *inputs* are, and they are validated.

---

## What makes this hard, honestly

**The prompts live in `index.html` and they are large.** `buildSystemPrompt()` and friends assemble the
system prompt from style, depth, specialty, boards difficulty, RAG context, guideline text and more. It
is not a string to copy — it is a substantial amount of logic, and it is the part of Chalk Talk that has
been tuned hardest.

Three ways to move it, in ascending order of cost and correctness:

| | approach | cost | what it buys |
|---|---|---|---|
| **A** | **Template id + validated parameters.** Client sends `{template: "talk.v3", topic, style, depth}`; the server holds the templates and interpolates. | moderate — port the prompt builders to the Worker | the client can no longer supply prompt *text*, only bounded choices |
| **B** | **Prompt hash allowlist.** Client still sends the prompt; the server hashes it and refuses anything not on a published allowlist. | low | catches tampering, but the allowlist must be regenerated on every prompt change and gives a false sense of coverage for dynamic parts |
| **C** | **Full server-owned generation.** Everything above plus RAG retrieval, guideline selection and reference assembly move server-side. | high — this is most of the generation pipeline | the client becomes a view, and the guarantee is complete |

**Recommendation: A, then C if it earns it.** B looks cheap and is a trap — the prompts are assembled
dynamically, so a hash allowlist either covers only the static skeleton (weak) or requires enumerating
combinations (unmaintainable).

A gets the property that matters — *the server chose the words* — without moving retrieval. C is the
right end state but is a project, not a change.

---

## Sequencing, so nothing is half-migrated

1. **Move the templates.** Port the prompt builders into a shared module the Worker can import. They are
   pure functions of (style, depth, specialty, topic, context) — no DOM, no `S`. Test them by asserting
   the Worker and the current client produce **identical** output for a matrix of inputs, so the
   migration is provably behaviour-preserving before anything switches over.
2. **Add `/v1/generate`** alongside the existing route. Both live. The new one is used by nothing yet.
3. **Switch the front end** to `/v1/generate`. Ship. Watch.
4. **Add the named `aux` routes**, one at a time, each replacing one current `meterKind: "aux"` call.
5. **Retire `/v1/messages`** for free-tier traffic. BYOK users keep it — it is their key and their
   prompt, which is a different trust relationship entirely and should stay that way.

Each step is independently shippable and independently revertible. Step 1 is the bulk of the work and
carries no user-visible risk, which makes it the right thing to start with.

---

## Provenance — the piece that makes the allowlist mean something to a reader

Codex's addition, and it is the point of the whole exercise from a *reader's* perspective rather than a
billing one:

> "Generated by Chalk Talk" provenance must be issued only for a server-recorded, cleared-model job — not
> merely claimed by client JSON.

Today the badge is a property of the talk object the client assembles. After the migration it should be a
property the **server** attests: the job id exists in `generation_receipts`, every stage was redeemed
against a cleared model, and the finalised talk was written by the Workflow. Anything else renders
without the badge rather than with a false one.

That is what closes the loop. The writer allowlist stops an uncleared model producing a Chalk Talk talk;
server-issued provenance stops anything *else* being labelled as one. Neither is sufficient alone, and
the second is arguably what a physician reading a shared talk actually relies on.

**Add it as step 6 of the sequencing**, once generation is server-owned and there is a server-side record
to attest from.

## What this does NOT need

- **A Durable Object.** Atomicity is solved: redemption is a Postgres `UPDATE … WHERE used < max`.
- **Changing the Workflow.** It already owns execution; it would simply receive server-built prompts
  instead of client-supplied ones.
- **Touching BYOK.** A user spending their own key may send whatever they like. The guarantee being
  protected is about *Jenni's key* and *the Chalk Talk name on a talk*.

---

## Until it is built

What holds today, stated precisely:

- Every free-tier call is **authorised** — bound to a paying user, a specific job, a specific stage, and
  a specific model set. Nothing reaches Anthropic unauthorised.
- A Chalk Talk **talk** is written only by a model on `WRITER_CLEARED`.
- Every call is **bounded and attributable**, and redemption is atomic.

What does not hold:

- The server does not know *what* it is generating. A caller with a valid receipt can spend their own
  bounded budget on a prompt of their choosing.

That residual is the reason to build this. It is not, in my judgement, a reason to delay launch: the
exposure is a user spending their own quota on their own prompt with a cleared model — which costs Jenni
one talk's worth of tokens, the same as legitimate use. The medical-content risk is that such output
could be *mistaken* for a Chalk Talk talk, and that is a labelling and provenance question as much as an
authorisation one.

**Decide it deliberately rather than inheriting it.**
