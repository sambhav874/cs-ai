# ContractSense AI - UI Design Guidelines
**Framework:** Next.js
**Styling:** Tailwind CSS

## 1. Core Design Tokens
These are the foundational colors for the automated contract review and compliance analysis interface. NEVER deviate from these exact hex codes. Do not let Tailwind guess approximate colors. 

Extend the Tailwind config (`tailwind.config.js`) with these custom values:
*   **Background (Global):** `#FFFFFF` (White) - Used for the main app background, sidebar, and internal cards.
*   **Primary Accent:** `#015CA9` (Corporate Blue) - Replaces all previous warm/orange accents. Use for primary action buttons (e.g., "Upload"), active sidebar highlights, active tab underlines, and focus rings.
*   **Secondary Accent:** `#EE3224` (Red) - Use sparingly for critical alerts, warning badges, or destructive actions (e.g., "Needs action" flags or deleting a contract).
*   **Muted / Neutral:** `#A7A9AC` (Gray) - Use for secondary typography (timestamps, uploader names), breadcrumb trails, inactive tab text, inactive sidebar links, and search placeholder text.
*   **Surface Borders:** `border-gray-200` (Tailwind default) - Use for the thin borders separating table rows, sidebar dividers, and card outlines.

## 2. Layout & Composition
The interface relies on a dense, data-heavy layout optimized for document management. 

*   **Global Layout:** Two-column structure. A fixed-width left sidebar for global navigation and a fluid right main content area.
*   **Main Content Padding:** The main content area MUST have consistent padding (e.g., `p-6` or `p-8`).
*   **Page Header:** Consists of breadcrumbs (Muted), a large Page Title (`text-2xl` or `text-3xl`, bold, dark gray/black), and a top-right action row (search bars, action buttons).
*   **Tab Navigation:** Below the page header, use a horizontal list. Active tabs MUST have a bottom border of `border-b-2 border-[#015CA9]` and bold text. Inactive tabs use the Muted color.

## 3. Component Rules
When generating or refactoring UI components, adhere strictly to these structural rules:

*   **Data Tables:**
    *   Tables are wrapped in a container card with a white background, a 1px solid light gray border, and `rounded-xl` corners.
    *   Table headers (`<th>`) must be left-aligned, use Muted text, and have a smaller text size (e.g., `text-sm font-medium`).
    *   Rows (`<tr>`) must be separated by a 1px solid light gray bottom border. Hover states on rows should use a very subtle gray background (e.g., `hover:bg-gray-50`).
*   **Buttons:**
    *   *Primary Buttons:* Background `#015CA9`, text white, `rounded-md`, standard padding (e.g., `px-4 py-2`).
    *   *Outline Buttons (e.g., "Refresh", "Settings", "View"):* Background transparent, border 1px solid light gray, text dark gray, `rounded-md`. Hover state changes border to `#015CA9`.
*   **Badges / Status Pills (e.g., "Ingested"):**
    *   Must be pill-shaped (`rounded-full`).
    *   Use a highly transparent background of the primary color (e.g., `bg-[#015CA9]/10`) with solid primary text (`text-[#015CA9]`).
    *   Small text size (`text-xs font-semibold`), padded tightly (`px-2.5 py-0.5`).
*   **Inputs & Search:**
    *   Outlined with light gray border, `rounded-md`.
    *   Focus state MUST trigger a ring using the Primary color: `focus:ring-2 focus:ring-[#015CA9] focus:outline-none`.

## 4. Strict AI Directives (ALWAYS / NEVER)
*   **ALWAYS** use Tailwind CSS utility classes for styling.
*   **ALWAYS** maintain a clean, high-contrast, enterprise-grade aesthetic suitable for legal standard reviews.
*   **NEVER** introduce new colors outside of the defined tokens. If a shade is needed, use Tailwind's default gray scale (`gray-50` to `gray-900`) or apply an opacity modifier to the core tokens (e.g., `text-[#A7A9AC]/80`).
*   **NEVER** use large, blocky drop shadows. The UI is inherently flat. Only use `shadow-sm` on the main data container or dropdown menus.
*   **NEVER** invent new icons. Assume a standard library (like Lucide React or Heroicons) and use standard names (e.g., `<UploadIcon />`, `<SettingsIcon />`).
