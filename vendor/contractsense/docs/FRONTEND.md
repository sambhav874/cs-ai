# Frontend Documentation

The frontend is a **Next.js 15** application using the App Router, React 19, Tailwind CSS, Radix UI primitives, and Framer Motion. It communicates with the backend via REST API and WebSocket.

---

## Table of Contents

- [Directory Layout](#directory-layout)
- [Pages & Routing](#pages--routing)
- [Key Components](#key-components)
- [Hooks](#hooks)
- [State Management & Context](#state-management--context)
- [API Communication](#api-communication)
- [WebSocket (Real-Time Job Status)](#websocket-real-time-job-status)
- [Authentication Flow](#authentication-flow)
- [UI Component Library](#ui-component-library)
- [Styling](#styling)
- [PDF Export](#pdf-export)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Adding a New Page](#adding-a-new-page)

---

## Directory Layout

```
apps/frontend/
├── app/                    # Next.js App Router (file-system routing)
│   ├── layout.tsx          # Root layout (providers, global styles)
│   ├── page.tsx            # Landing / home page
│   ├── globals.css         # Global CSS (Tailwind base + custom vars)
│   ├── signin/             # Sign-in page
│   ├── signup/             # Sign-up / Registration page
│   ├── dashboard/          # Main dashboard after login
│   ├── contracts/          # Contract list and detail views
│   ├── reports/            # IFRS 15 report viewer
│   ├── audit/              # Audit log viewer
│   ├── history/            # Processing history
│   ├── teams/              # Team management pages
│   ├── account/            # User account settings
│   ├── billing/            # Billing / subscription management
│   ├── credits/            # Credits overview
│   ├── beta/               # Beta application form
│   ├── support/            # Support ticket form
│   └── assessment/         # Contract assessment tool
│
├── components/             # Reusable UI components
│   ├── ui/                 # shadcn/ui + custom base primitives
│   └── [feature]/          # Feature-specific component groups
│
├── hooks/                  # Custom React hooks
│   ├── useJobStatus.ts     # WebSocket hook for real-time job progress
│   └── ...
│
├── lib/                    # Utility functions and API client
│   ├── api.ts              # Axios API client (baseURL, auth interceptor)
│   └── ...
│
├── context/                # React Context providers
│
├── types/                  # TypeScript type definitions
│
├── public/                 # Static assets
│
├── styles/                 # Additional CSS files
│
├── next.config.ts          # Next.js configuration
├── tailwind.config.ts      # Tailwind CSS configuration
└── tsconfig.json           # TypeScript configuration
```

---

## Pages & Routing

All pages use the **Next.js App Router**. Each directory under `app/` that contains a `page.tsx` file becomes a route.

| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing page, marketing content |
| `/signin` | `app/signin/page.tsx` | Login form |
| `/signup` | `app/signup/page.tsx` | Registration form |
| `/dashboard` | `app/dashboard/page.tsx` | Overview dashboard with stats |
| `/contracts` | `app/contracts/page.tsx` | Contract list + upload |
| `/contracts/[id]` | `app/contracts/[id]/page.tsx` | Contract detail view (Raw / Summary / Q&A) |
| `/reports/[id]` | `app/reports/[id]/page.tsx` | IFRS 15 report viewer |
| `/audit` | `app/audit/page.tsx` | Audit log browsing |
| `/history` | `app/history/page.tsx` | Processing job history |
| `/teams` | `app/teams/page.tsx` | Team management |
| `/account` | `app/account/page.tsx` | Account settings |
| `/billing` | `app/billing/page.tsx` | Subscription & payment |
| `/credits` | `app/credits/page.tsx` | Credit balance and history |
| `/beta` | `app/beta/page.tsx` | Beta signup form |
| `/support` | `app/support/page.tsx` | Support ticket form |
| `/assessment` | `app/assessment/page.tsx` | Contract assessment questionnaire |

---

## Key Components

### Contract Upload

Located in the contracts page. Uses `react-dropzone` for drag-and-drop PDF upload. Sends the file via `multipart/form-data` to `POST /api/v1/contracts/upload`.

On successful upload, receives a `contract_id` and immediately connects to the WebSocket to track progress.

### Contract Detail View

The core user interface. Features:
- **Resizable panel layout** using `react-resizable-panels` — users can drag the divider to resize the PDF viewer and analysis panes.
- **Left pane**: PDF rendered via `react-pdf` (`pdfjs-dist`).
- **Right pane**: Tabbed view with:
  - **Raw** tab: Full markdown content via `react-markdown`
  - **Summary** tab: Executive summary
  - **Q&A** tab: Structured question-answer results
  - **Report** tab: IFRS 15 report

### Report Viewer

Renders the IFRS 15 report in a paginated "Digital A4 Document" layout styled to match a professional PDF. Users can export to PDF via `html2pdf.js` / `jsPDF`.

### Progress Indicator

Displays real-time processing progress driven by the `useJobStatus` WebSocket hook. Shows the current stage (Indexing → Summarising → Processing) with an animated progress bar.

---

## Hooks

### `useJobStatus` (`hooks/useJobStatus.ts`)

Establishes a WebSocket connection to the backend and returns live job progress.

```typescript
const { progress, currentStep, status, error } = useJobStatus(contractId, authToken);
```

| Return Value | Type | Description |
|---|---|---|
| `progress` | `number` | 0–100 overall completion percentage |
| `currentStep` | `string` | `"indexing" \| "summarizing" \| "processing"` |
| `status` | `string` | `"IN_PROGRESS" \| "COMPLETED" \| "FAILED"` |
| `error` | `string \| null` | Error message if failed |

The hook automatically:
- Appends the JWT as a query parameter (`?token=<JWT>`)
- Reconnects on disconnect (with exponential backoff)
- Cleans up the WebSocket on component unmount

---

## State Management & Context

The app uses **React Context** for global state that needs to be accessible across many pages:

| Context | File | Purpose |
|---|---|---|
| Auth context | `context/` | Current user, JWT token, login/logout actions |

For server state (data fetching, caching), the app uses `axios` directly in pages and components with `useEffect` and local `useState`. No external state management library (Redux, Zustand) is used.

---

## API Communication

All API calls go through the configured `axios` client in `lib/api.ts`.

### Client Setup

- `baseURL` is set from `NEXT_PUBLIC_API_URL` (e.g., `http://localhost:8000`)
- A request interceptor automatically attaches `Authorization: Bearer <token>` to every request
- A response interceptor handles 401 errors by redirecting to `/signin`

### Example: Fetching Contracts

```typescript
import api from '@/lib/api';

const response = await api.get('/api/v1/contracts');
const contracts = response.data;
```

### Example: Uploading a Contract

```typescript
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('questions', JSON.stringify(questions));
formData.append('ai_provider', 'anthropic');

const response = await api.post('/api/v1/contracts/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```

---

## WebSocket (Real-Time Job Status)

```
ws://<API_HOST>/api/v1/ws/job-status?token=<JWT_TOKEN>
```

The server sends JSON messages in this format:

```json
{
  "contract_id": "abc123",
  "job_type": "processing",
  "status": "IN_PROGRESS",
  "current_step": "summarizing",
  "progress": 42.5,
  "error": null
}
```

The `useJobStatus` hook handles parsing these messages and updating component state. CORS is **not enforced** for WebSocket connections (handled at the backend level); auth is enforced via the JWT token in the query string.

---

## Authentication Flow

1. User submits email + password on `/signin`
2. Frontend calls `POST /api/v1/auth/login`
3. Backend returns a JWT access token
4. Token stored in `localStorage` (or `sessionStorage`)
5. Auth context is populated; user is redirected to `/dashboard`
6. Axios interceptor attaches token to all subsequent requests
7. On 401 response, token is cleared and user is redirected to `/signin`

---

## UI Component Library

The frontend uses **shadcn/ui** components built on top of **Radix UI** primitives. These are located in `components/ui/` and are fully customisable.

Key component packages used:
- `@radix-ui/react-*` — Headless accessible primitives
- `lucide-react` — Icon set
- `framer-motion` / `motion` — Animations
- `sonner` — Toast notifications
- `react-hook-form` + `zod` — Form management and validation
- `recharts` / `chart.js` — Data visualisation
- `embla-carousel-react` — Carousels
- `cmdk` — Command palette

---

## Styling

- **Tailwind CSS** is the primary styling system (configured in `tailwind.config.ts`)
- **CSS custom properties** (CSS variables) are defined in `app/globals.css` for the design token system (colors, radii, shadows)
- **`next-themes`** powers light/dark mode switching
- Component variants are defined using `class-variance-authority` (CVA)

---

## PDF Export

Multiple export strategies are available depending on the context:

| Library | Use Case |
|---|---|
| `jsPDF` + `jspdf-autotable` | Tabular data exports |
| `html2pdf.js` | IFRS report ("Digital A4") export |
| `html2canvas` | Screenshot-based PDF export |
| `@react-pdf/renderer` | Programmatic PDF generation with React components |
| `react-to-print` | Direct browser print dialog |

---

## Running Locally

```bash
cd apps/frontend
cp .env.example .env    # set NEXT_PUBLIC_API_URL
npm install
npm run dev             # starts on http://localhost:4200
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the backend API |

---

## Adding a New Page

1. Create `app/my-page/page.tsx`:

```tsx
export default function MyPage() {
  return <div>Hello World</div>;
}
```

2. The page is automatically available at `/my-page`.

3. Add a link in the navigation component (`components/nav/` or similar).

4. If the page requires authentication, wrap it with the auth guard component or use middleware in `middleware.ts`.
