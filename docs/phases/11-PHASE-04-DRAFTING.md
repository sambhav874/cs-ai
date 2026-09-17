# Phase 04 — Drafting & Templates

**Goal**: Build the contract creation engine — template management, clause library, AI-powered drafting, and the rich contract editor. At the end of this phase, you can create templates, manage clauses, and generate contracts via chat or form.

**Duration estimate**: 3–4 weeks (most complex phase)  
**Depends on**: Phase 1, Phase 2, Phase 3

---

## What You Build

### Backend
- [ ] Database migrations: `templates`, `template_sections`, `clause_categories`, `clause_library_items`, `playbook_positions`
- [ ] Template Service: CRUD, versioning, conditional logic engine, preview/test generation
- [ ] Clause Service: CRUD, versioning, category tree, usage tracking
- [ ] Playbook Service: CRUD positions, risk thresholds, version history
- [ ] Document generation engine: assemble document from template + clauses + variable data
- [ ] Variable field population: merge CRM/request data into template fields
- [ ] Conditional section logic: evaluate rules to include/exclude template sections
- [ ] Document format conversion: generate DOCX and PDF from internal format

### Agent Layer
- [ ] Draft Agent (full): template selection, clause assembly, variable population, document generation
- [ ] Review Agent (enhanced): extract terms from uploaded third-party documents, risk scoring
- [ ] Inline AI assist: rewrite, simplify, expand, check compliance, suggest alternatives
- [ ] Chat flow CHAT-001 (complete): "Draft an NDA for Acme" → full end-to-end generation
- [ ] Chat flow CHAT-005: "Review this contract" → upload, extract, summarize, risk score
- [ ] Chat flow CHAT-010: "Help me understand this contract" → plain-English summary

### Frontend
- [ ] **SCR-015: Template Builder + Library** — browse templates, create/edit with section composer, conditional logic, preview with sample data
- [ ] **SCR-016: Clause Library** — category tree, clause list, clause editor, version history, usage stats. Both standalone and embedded panel mode.
- [ ] **SCR-036: Playbook Editor** — clause category tree, position hierarchy (preferred/acceptable/fallback/walkaway), risk thresholds, test mode
- [ ] **SCR-006: Contract Editor** — rich text editor (TipTap/ProseMirror) with:
  - Formatting toolbar (headings, bold, italic, tables, lists)
  - Clause library side panel (search, browse, insert at cursor)
  - AI Assist context menu (select text → rewrite/simplify/expand/check compliance)
  - Variable fields (highlighted, auto-filled, click to edit)
  - Track changes (show/hide, accept/reject)
  - Section navigation sidebar (document outline)
  - Find and replace
  - Export (DOCX, PDF)
  - Word count and version indicator
- [ ] **SCR-007: Upload & Extract** — upload third-party contract, show extraction progress, display results
- [ ] **SCR-008: Comparison View** — side-by-side (their terms vs playbook), deviation highlighting, agent explanations
- [ ] **SCR-004: Template Selector** — modal that shows recommended templates with match scores
- [ ] **SCR-009: Bulk Generator** — upload CSV + select template → generate multiple contracts

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| CRUD | `/api/v1/templates` | Template management |
| POST | `/api/v1/templates/:id/generate` | Generate contract from template |
| POST | `/api/v1/templates/:id/preview` | Preview with sample data |
| CRUD | `/api/v1/clauses` | Clause library management |
| GET | `/api/v1/clause-categories` | Category tree |
| CRUD | `/api/v1/playbook/positions` | Playbook positions |
| POST | `/api/v1/playbook/test` | Test playbook against sample clause |
| POST | `/api/v1/agent/draft` | AI-assisted draft generation |
| POST | `/api/v1/agent/extract` | Extract from uploaded document |
| POST | `/api/v1/agent/compare` | Compare to playbook |
| POST | `/api/v1/agent/assist` | Inline AI assist (rewrite, simplify, etc.) |

---

## Acceptance Criteria

1. **Create a template** → add sections, insert clauses from library, set conditional logic, preview
2. **Create clauses** → organized by category, with versions and usage tracking
3. **Set playbook positions** → preferred/acceptable/fallback for each clause category
4. **Generate a contract via form** → select template, fill variables → complete draft generated
5. **Generate a contract via chat** → "Draft NDA for Acme" → agent selects template, fills data, generates draft
6. **Open in editor** → edit text, formatting works, clause panel available, AI assist works
7. **AI assist** → select a clause, click "Simplify" → agent rewrites in simpler language
8. **Upload third-party contract** → extract all key terms, risk score, deviation list
9. **Compare to playbook** → side-by-side view with deviations highlighted and explained
10. **Template conditional logic** → if deal value > $1M → SLA section appears; otherwise hidden
11. **Bulk generation** → upload CSV with 10 employee records → 10 contracts generated from template

---

## Feature IDs Covered

`DR-001` through `DR-012`, `CFG-003`, `CFG-004`, `CFG-005`, `CHAT-001` (complete), `CHAT-005`, `CHAT-010`

## Screens Built

SCR-004, SCR-006, SCR-007, SCR-008, SCR-009, SCR-015, SCR-016, SCR-036
