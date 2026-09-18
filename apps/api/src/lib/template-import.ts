/**
 * Template import — turn a converted document into template sections.
 *
 * Kept out of the route handler so the splitting rules are unit-testable:
 * the heading-promotion behaviour below is easy to get subtly wrong and it
 * directly shapes what every generated contract looks like.
 */

export const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export interface ImportedSection {
  title: string
  content: string
  sortOrder: number
}

/**
 * Split converted DOCX HTML into template sections along its h1/h2 outline.
 * mammoth maps Word heading styles onto <h1>/<h2>, which lines up with how
 * template sections are authored by hand.
 *
 * The promoted heading element is REMOVED from the section body on purpose:
 * template-engine re-emits `section.title` as an <h2 class="section-title">,
 * so leaving the original heading in the content would render every heading
 * twice in every generated document.
 *
 * A document with no headings falls back to one section holding the whole
 * body — still a usable starting point in the editor.
 */
export function splitHtmlIntoSections(
  html: string,
  fallbackTitle: string,
): ImportedSection[] {
  const parts = html
    .split(/(?=<h[12][\s>])/i)
    .map(p => p.trim())
    .filter(Boolean)

  // Only a genuinely empty document short-circuits. Note a single-heading
  // document also yields exactly one part, so "one part" must NOT be treated
  // as "no headings" — doing so left the heading in the body and dropped its
  // title, which is the duplicate-heading bug this function exists to avoid.
  if (parts.length === 0) {
    return [{ title: fallbackTitle, content: '', sortOrder: 0 }]
  }

  return parts.map((part, i) => {
    const heading = part.match(/^<h[12][^>]*>([\s\S]*?)<\/h[12]>\s*/i)
    const title = heading ? stripTags(heading[1]) : ''
    return {
      title:     title || (i === 0 ? fallbackTitle : `Section ${i + 1}`),
      content:   heading ? part.slice(heading[0].length).trim() : part,
      sortOrder: i,
    }
  })
}
