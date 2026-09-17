# 07 — UI Design System

## Design Philosophy

1. **Agent-aware**: UI surfaces are designed to receive and display agent output — streaming text, generated summaries, risk badges, confidence indicators. Every screen has an "agent integration point."
2. **Contextual, not navigational**: Users should reach any screen in ≤2 clicks OR via agent link. The chat panel is always available (Cmd+K).
3. **Progressive disclosure**: Simple tasks show minimal UI. Complex tasks reveal detail on demand.
4. **Information density over decoration**: CLM users are professionals managing large portfolios. Optimize for data density, scannability, and fast action — not visual flair.
5. **Accessible by default**: WCAG 2.1 AA compliance. Keyboard navigable. Screen reader friendly. Color never sole information carrier.

---

## Design Tokens

### Colors

```css
:root {
  /* Brand */
  --color-primary: #1B2A4A;        /* Deep navy — headers, primary actions */
  --color-primary-light: #2E5090;   /* Lighter navy — hover states */
  --color-accent: #3B82F6;          /* Blue — links, active states */

  /* Semantic */
  --color-success: #16A34A;         /* Green — approved, complete, low risk */
  --color-warning: #D97706;         /* Amber — approaching, medium risk */
  --color-danger: #DC2626;          /* Red — overdue, rejected, high risk */
  --color-info: #2563EB;            /* Blue — informational badges */

  /* Risk spectrum (used in risk scores and heat maps) */
  --color-risk-low: #16A34A;
  --color-risk-medium: #D97706;
  --color-risk-high: #DC2626;
  --color-risk-critical: #991B1B;

  /* Contract status colors */
  --color-status-draft: #6B7280;
  --color-status-review: #2563EB;
  --color-status-negotiation: #D97706;
  --color-status-approval: #7C3AED;
  --color-status-signature: #D946EF;
  --color-status-active: #16A34A;
  --color-status-expired: #DC2626;

  /* Surfaces */
  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F9FAFB;
  --color-bg-tertiary: #F3F4F6;
  --color-bg-elevated: #FFFFFF;

  /* Text */
  --color-text-primary: #111827;
  --color-text-secondary: #6B7280;
  --color-text-tertiary: #9CA3AF;
  --color-text-inverse: #FFFFFF;

  /* Borders */
  --color-border-primary: #D1D5DB;
  --color-border-secondary: #E5E7EB;
  --color-border-focus: #3B82F6;
}
```

### Typography

```css
:root {
  --font-sans: 'Inter', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-xs: 0.75rem;    /* 12px — badges, metadata */
  --text-sm: 0.875rem;   /* 14px — secondary text, table cells */
  --text-base: 1rem;     /* 16px — body text */
  --text-lg: 1.125rem;   /* 18px — section headers */
  --text-xl: 1.25rem;    /* 20px — page headers */
  --text-2xl: 1.5rem;    /* 24px — page titles */

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;
}
```

### Spacing

```css
:root {
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */
  --space-12: 3rem;    /* 48px */

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
}
```

---

## Core Components

### Buttons

| Variant | Use | Style |
|---------|-----|-------|
| Primary | Main action (Submit, Create, Approve) | Solid navy bg, white text |
| Secondary | Secondary action (Cancel, Back) | White bg, navy border |
| Success | Positive action (Approve, Complete) | Solid green bg |
| Danger | Destructive action (Reject, Delete) | Solid red bg |
| Ghost | Tertiary action (Clear, Reset) | No bg, text only |
| Icon | Action with icon only | Circle or square, no text |

### Status Badges

Used everywhere contracts appear. Color-coded per status. Consistent across all screens.

```tsx
<StatusBadge status="in_negotiation" /> // Amber badge: "In Negotiation"
<StatusBadge status="active" />         // Green badge: "Active"
<RiskBadge score={0.78} />              // Red badge: "High Risk (78%)"
<PriorityBadge priority="urgent" />     // Orange badge: "Urgent"
```

### Data Tables

Standard table component used across all list views (contracts, requests, obligations, approvals).

Features:
- Sortable columns (click header to sort)
- Resizable columns (drag border)
- Pinnable columns (freeze left columns)
- Row selection (checkboxes for bulk actions)
- Inline actions (hover to reveal action buttons)
- Empty state (illustration + message + action button)
- Loading state (skeleton rows)
- Pagination (bottom bar with page size selector)
- Column visibility toggle (show/hide columns)
- Export button (CSV, Excel)

### Cards

| Type | Use | Structure |
|------|-----|-----------|
| Metric Card | Dashboard KPIs | Label (muted) + Large number + Trend indicator |
| Contract Card | Grid view of contracts | Title + counterparty + status badge + key info + actions |
| Approval Card | Approval inbox | Contract summary + risk score + recommendation + approve/reject |
| Obligation Card | Obligation list | Title + due date + owner + status traffic light + contract link |
| Agent Message Card | Chat responses | Formatted message + action buttons + expand/collapse |

### Modals / Dialogs

- **Confirmation dialogs**: used for destructive actions (delete, reject, void). Always require explicit confirmation.
- **Detail modals**: used for quick views without navigating away (clause preview, user profile).
- **Form modals**: used for quick data entry (add comment, create tag, quick assign).
- Maximum width: 640px. Always dismissible via Escape or clicking backdrop.

### Chat Panel

Persistent, collapsible panel available on every page. Docked to the right side.

States:
- **Collapsed**: Small floating button (bottom-right) with unread badge
- **Expanded**: 400px wide panel with conversation history + input box
- **Fullscreen**: Takes over entire viewport (on mobile, or when complex response needs space)

Features:
- Streaming text display (token-by-token with cursor animation)
- Rich message formatting (bold, lists, code blocks, tables)
- Action buttons within messages (View Contract, Approve, Edit, etc.)
- File attachment in messages (upload contract for review)
- Message history with search
- Context indicator (shows which contract/request is in context)

---

## Layout Patterns

### App Shell

```
┌─────────────────────────────────────────────────────────┐
│ Header: Logo │ Global Search │ Notifications │ New │ User│
├────────┬────────────────────────────────────────────────┤
│        │                                          │     │
│  Left  │          Main Content Area               │Chat │
│  Nav   │                                          │Panel│
│  (220px│          (flexible width)                 │(400 │
│  fixed)│                                          │ px) │
│        │                                          │     │
│        │                                          │     │
└────────┴────────────────────────────────────────────────┘
```

### Screen Layout Types

| Type | Used For | Structure |
|------|----------|-----------|
| List + Detail | Repository, Requests, Obligations | Table on left, detail panel on right (resizable split) |
| Full Width | Editor, Workflow Builder, Playbook | Content fills main area, no split |
| Dashboard | Analytics, KPIs, Executive view | Grid of widget cards |
| Wizard | Setup, Bulk Import | Step indicator + single-step content |
| Portal | External negotiation, Signing | Standalone page, no app shell |

### Responsive Breakpoints

| Breakpoint | Width | Layout Change |
|------------|-------|---------------|
| Desktop | ≥1280px | Full layout with sidebar + chat panel |
| Tablet | 768–1279px | Sidebar collapses to icons, chat panel overlays |
| Mobile | <768px | No sidebar (hamburger menu), full-width content, bottom nav |

---

## Agent UX Patterns

### Confidence Indicators

When agents provide analysis, always show confidence visually:

```tsx
// Risk score badge
<RiskScore value={0.78} /> // Shows "78% risk" with red color, filled bar

// Agent recommendation
<AgentRecommendation
  action="approve"
  confidence={0.92}
  reasoning="All terms per playbook. Standard NDA with no deviations."
/>
// Shows: ✓ Recommended: Approve (92% confidence)
// Expandable reasoning below
```

### Streaming Response Display

Agent chat responses stream token-by-token:
- Typing indicator (3 dots) before first token arrives
- Text appears word-by-word (50ms per token)
- Cursor blinks at end of current text
- Action buttons appear AFTER streaming completes (not during)
- User can interrupt (stop generation) at any time

### Agent-Generated UI Surfaces

When agents generate dashboards, comparison views, or reports, they return structured JSON that the frontend renders into pre-built components. Agents never return raw HTML.

```json
{
  "surface_type": "comparison_table",
  "title": "EMEA Vendor Payment Terms",
  "columns": ["Vendor", "Payment Terms", "Discount", "Annual Spend"],
  "rows": [...],
  "actions": [
    { "label": "Export to Excel", "action": "export", "params": {...} },
    { "label": "Identify Renegotiation Opportunities", "action": "sendPrompt", "prompt": "..." }
  ]
}
```

---

## Accessibility Requirements

- All interactive elements keyboard accessible (Tab, Enter, Escape, Arrow keys)
- Focus indicators visible on all interactive elements (2px blue outline)
- Color contrast minimum 4.5:1 for text, 3:1 for large text and UI elements
- All images/icons have alt text or aria-label
- Screen reader announcements for dynamic content (toast notifications, status changes)
- Reduced motion mode: disable all animations when `prefers-reduced-motion` is set
- Document editor: full keyboard navigation, screen reader compatible headings and regions
- Forms: labels associated with inputs, error messages linked via aria-describedby
