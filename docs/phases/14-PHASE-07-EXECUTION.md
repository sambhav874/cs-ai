# Phase 07 — Execution & eSignature

**Goal**: Build the signing experience — eSignature integration, signing UX for external parties, auto-filing of executed contracts. After this phase, a contract can go from draft to fully signed.

**Duration estimate**: 2 weeks  
**Depends on**: Phase 6 (approved contracts ready to sign)

---

## What You Build

### Backend
- [ ] Database migrations: `signature_requests`
- [ ] Signature Service: prepare packet, send via eSign API, monitor status, process completion
- [ ] DocuSign integration: create envelope, add signers, place fields, send, webhook listener for status updates
- [ ] Auto-filing: on signature completion → create final version, extract metadata, update contract status to "executed", link to CRM
- [ ] Countersignature workflow: external party signs → route to internal signatory
- [ ] Reminder service: configurable intervals, max reminders, escalation to requestor

### Agent Layer
- [ ] Signature Agent: identify signature fields in document, suggest signing order, prepare packet
- [ ] Auto-filing agent: on execution → extract final terms, create obligation records (triggers Phase 8), generate embeddings, update CRM
- [ ] Proactive monitoring: agent monitors signature status, sends reminders, alerts on stalls

### Frontend
- [ ] **SCR-006 enhancement**: signature field placement mode — drag signature/initial/date fields onto document
- [ ] **SCR-018: Signing Page** — branded external signing experience (standalone page, no app shell), scroll-through document, click-to-sign fields, download signed copy, audit trail receipt
- [ ] **SCR-019: Signature Tracker** — status dashboard for all pending signatures, per-signer status, reminder controls, void/cancel actions
- [ ] Contract detail enhancement: "Send for Signature" button in approved contracts, signature status in overview tab

### Acceptance Criteria

1. **Prepare for signing** → open approved contract → place signature fields → select signers and order
2. **Send for signature** → one click → DocuSign envelope created → signers receive email
3. **External signing experience** → signer clicks email link → branded page → scrolls through → signs → downloads copy
4. **Internal countersignature** → after external party signs → internal signatory receives notification → signs
5. **Signature tracking** → see all pending signatures, per-signer status (sent/viewed/signed)
6. **Reminders** → signer hasn't signed in 3 days → automatic reminder sent → visible in tracker
7. **Completion** → all parties sign → contract auto-filed in repository with "executed" status
8. **Auto-extraction** → on execution → agent extracts final terms, creates obligation records
9. **CRM update** → on execution → contract status synced to CRM record (placeholder for Phase 10)
10. **Void/cancel** → cancel a pending signature request → signers notified

---

## Feature IDs Covered

`EX-001` through `EX-006`

## Screens Built

SCR-018, SCR-019, SCR-006 (signature mode enhancement)
