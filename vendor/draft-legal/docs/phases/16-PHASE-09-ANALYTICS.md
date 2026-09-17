# Phase 09 — Analytics & Reporting

**Goal**: Build the intelligence layer — executive dashboards, conversational analytics, report builder, KPI tracking, and compliance evidence packages. Transform contract data into business insights.

**Duration estimate**: 2.5 weeks  
**Depends on**: Phase 2 (repository), Phase 8 (obligations data)

---

## What You Build

### Backend
- [ ] Analytics query engine: aggregate contract data (ClickHouse for analytical queries)
- [ ] Dashboard data API: configurable widget data endpoints (metrics, charts, tables)
- [ ] Report builder backend: save report definitions, scheduled execution, export (PDF/Excel/PPT)
- [ ] KPI calculation engine: cycle time, first-pass approval rate, template usage, obligation compliance
- [ ] Compliance evidence package generator: compile audit trail into structured, certified PDF
- [ ] Event pipeline: stream events from PostgreSQL to ClickHouse for fast analytical queries

### Agent Layer
- [ ] Insight Agent (full): interpret natural language analytics queries, generate appropriate visualizations, identify trends, generate recommendations
- [ ] Chat flow CHAT-003 (enhanced): "Show me all contracts expiring in Q3" with generated dashboard
- [ ] Chat flow CHAT-007: "Compare payment terms across EMEA vendors" → structured comparison
- [ ] Proactive insights: agent detects anomalies (cycle time spike) and alerts stakeholders

### Frontend
- [ ] **SCR-027: Executive Dashboard** — widget-based configurable dashboard, metric cards, stage distribution chart, risk heat map, cycle time trends, upcoming renewals, top bottlenecks, date range selector, widget customization, export to PDF/PPT
- [ ] **SCR-028: Report Builder** — drag-and-drop field selector, filter config, chart type selector, grouping/pivoting, save, schedule, share, export
- [ ] **SCR-029: Compliance Evidence Package** — structured audit trail viewer, compliance checklist, exportable certified PDF
- [ ] **SCR-030: KPI Dashboard** — KPI scorecards with trend lines, targets, drill-down capability
- [ ] Conversational analytics: ask question in chat → agent generates interactive chart/table inline
- [ ] Dashboard as the new home page: role-based defaults (exec sees portfolio, legal sees pending work, sales sees pipeline)

### Acceptance Criteria

1. **Executive dashboard** → see total contracts, value, risk distribution, cycle times, renewal calendar
2. **Drill-down** → click any chart element → filtered view of underlying contracts
3. **Conversational analytics** → "Show me cycle time by deal size for Q3" → agent generates chart in chat
4. **Report builder** → drag fields, set filters → save recurring report → schedule weekly email delivery
5. **KPI tracking** → draft-to-sign cycle time trending up → visible on KPI dashboard
6. **Compliance package** → generate audit evidence for specific contract → certified PDF exported
7. **Widget customization** → add/remove/resize dashboard widgets → layout saved per user
8. **Export** → export any dashboard or report to PDF, Excel, or PPT
9. **Role-based dashboards** → exec sees portfolio view, legal sees workload, sales sees pipeline
10. **Proactive insight** → agent detects cycle time spike → sends alert to legal ops

---

## Feature IDs Covered

`AN-001` through `AN-006`, `CL-002`, `CL-003`, `CHAT-003` (enhanced), `CHAT-007`

## Screens Built

SCR-027, SCR-028, SCR-029, SCR-030, SCR-032 (Activity Feed), SCR-033 (Notification Preferences)
