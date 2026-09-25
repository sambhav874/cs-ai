# Licensing position

`vendor/draft-legal` is imported from https://github.com/AniketTati/draft-legal
(commit `89382a1`, 2026-08-29) and is licensed **AGPL-3.0**. We reuse its code.

## What triggers nothing

Building, running and evaluating internally. All of Phase 0 and most of Phase 1
sits here. No decision is required to keep working.

## What triggers the obligation

Offering a modified version to other people over a network (AGPL §13), or
distributing it. At that point the corresponding source must be offered to those
users. Both planned delivery modes cross this line: SaaS is the network case,
self-host is distribution.

**The decision is due before the first external customer, not before the first
commit.**

## Three exits, all currently open

| Exit | Cost |
| --- | --- |
| Publish this repo under AGPL | The code becomes public; competitors can run it |
| Buy a commercial licence | `vendor/draft-legal/CLA.md` lets the maintainer grant one, and their README invites the conversation. Cost unknown |
| Replace the reused modules | Largest engineering cost, and it grows the longer we build on the code |

The third exit gets more expensive over time. That is the reason for the hygiene
rules below rather than a reason to decide now.

## Hygiene that keeps all three open

1. draftLegal's `LICENSE` and file headers stay intact wherever its code lives.
2. Its code stays in identifiable directories rather than smeared across ours.
   Bridge and reuse sites are marked `TODO(licence)` so the pre-launch decision
   has an exact inventory instead of a guess.
3. Git history records what came from where. Both codebases are imported with
   `git subtree`, so provenance survives and an upstream security fix arrives
   through a reviewable `git subtree pull`.

## Related pre-launch legal item

Separate from the licence, on the same pre-launch list: the e-signature audit
trail needs legal review for ESIGN and eIDAS validity. The cryptography is real
(PAdES X.509 seal, SHA-256 hash), but a valid seal and a legally sufficient
audit trail are different questions.

## TODO(licence) inventory

Every AGPL directory carries a `TODO(licence)` line in its NOTICE:
`apps/api`, `apps/web`, `packages/types`, `apps/intelligence/agents_service`.

Bridge and reuse sites outside those directories — ContractSense code that runs,
imports or derives from draftLegal code — are marked in the file:

| File | What crosses |
|---|---|
| `apps/intelligence/services/assistant/engine.py` | the platform assistant runs draftLegal's tools, prompt rules and eval replay seam on ContractSense's runtime |
| `apps/intelligence/services/assistant/lifecycle.py` | draftLegal's agent tools, wrapped for the runtime |
| `apps/intelligence/services/assistant/frames.py` | draftLegal's chat stream protocol |
| `apps/intelligence/services/assistant/prompt.py` | draftLegal's orchestrator routing rules, moved verbatim |
| `apps/intelligence/services/key_terms.py`, `key_terms_schema.py` | the review agent's field model, clause taxonomy and classification text |

List them with `grep -rn "TODO(licence)" apps packages docs`.
