# Contributing as a Legal / Contracts Expert — no code required

You don't need to write a single line of code to make draftLegal better.

draftLegal's AI is only as good as the legal knowledge behind it — the clause
libraries it drafts from, the playbook rules it negotiates against, and the
templates it generates. **That knowledge comes from people like you:** in-house
counsel, legal-ops professionals, contracts managers, and practicing lawyers.

This is something no closed-source CLM can offer. Ironclad and Harvey decide what
"good" looks like behind closed doors. Here, the legal community shapes the product
in the open — and you get credited for it.

## What you can contribute

| Contribution | What it is | Effort |
|---|---|---|
| 📄 **Contract templates** | A standard NDA, MSA, SOW, DPA, etc. the AI can draft from | 30–60 min |
| 📋 **Playbook rules** | "Our position on liability caps is 1× annual fees; walk-away at 2×" — the rules the negotiate agent uses | 15–30 min each |
| 📚 **Clause libraries** | Preferred / fallback / unacceptable language for a clause type (indemnification, limitation of liability, termination) | 15–30 min each |
| 🌍 **Jurisdiction packs** | Governing-law nuances, mandatory terms, enforceability notes for a country/state | varies |
| ✅ **Validate AI reasoning** | Try the agent on a real-ish scenario and tell us where its legal reasoning is wrong | 20 min |

## How to contribute (two easy paths)

### Path A — Open an issue (easiest, recommended to start)

1. Go to [Issues → New Issue](https://github.com/AniketTati/draft-legal/issues/new).
2. Pick the **"Legal content"** template (or just describe what you want to add).
3. Paste your template / clause / playbook position as plain text. That's it — a
   maintainer or developer will wire it into the right place and credit you.

This is perfect if you're not comfortable with GitHub's file editing. **Write the
legal content; we'll handle the plumbing.**

### Path B — Edit a file directly (if you're GitHub-comfortable)

The legal knowledge lives in a few seed files. You can propose edits right in the
browser (GitHub's pencil icon → "propose changes" creates a PR for you):

| What | Where |
|---|---|
| Templates | `apps/api/scripts/fixtures/` + `apps/api/scripts/seed-ai-demo.ts` |
| Playbook rules | `apps/api/scripts/seed-playbook-rules.ts` |
| Clause libraries | `apps/api/scripts/seed-clauses.ts` |

You don't need to run anything — open the PR with your content and a maintainer
will validate the format and merge.

## What makes a great contribution

- **Real-world, not textbook.** The clause language you'd actually accept in a deal.
- **Position + rationale.** For playbook rules, say *why* — "we cap liability at 1×
  fees because [reason]." The AI uses the rationale to explain its recommendations.
- **Cite where useful.** If a position is jurisdiction-specific, note the jurisdiction.
- **Plain text is fine.** Don't worry about formatting or code — describe it clearly.

## Example: a playbook rule (just to show the shape)

> **Clause:** Limitation of Liability
> **Preferred position:** Liability capped at 1× fees paid in the trailing 12 months.
> **Fallback:** Up to 2× fees, only with a mutual cap and carve-outs for confidentiality + IP.
> **Walk-away:** Uncapped liability, or any cap above 2× fees.
> **Why:** Keeps downside proportional to contract value; 2× is our absolute ceiling for standard vendors.

You can literally paste something like that into an issue and it becomes part of
how the negotiate agent reasons.

## Recognition

Every legal contributor is credited in the release notes and the contributors list.
If you contribute a substantial jurisdiction pack or playbook, we'll happily call it
out by name — it's a genuine, citable open-source contribution to legal tech.

---

Questions about whether something's worth contributing? It almost certainly is —
open a [Discussion](https://github.com/AniketTati/draft-legal/discussions) and ask.
Thank you for helping make legal AI that the whole community can trust. ⚖️
