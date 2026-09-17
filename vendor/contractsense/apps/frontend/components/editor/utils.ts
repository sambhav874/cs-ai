export function plainTextToHtml(text: string): string {
  if (!text) return "";

  const parts: string[] = [];
  const lines = text.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Page break markers
    const pageMatch = trimmed.match(/^\[\[DOCX_PAGE:(\d+)\]\]$/);
    if (pageMatch) {
      parts.push(`<div data-page-break data-page="${pageMatch[1]}"></div>`);
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Paragraphs — collect consecutive non-empty lines
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().match(/^(#{1,3})\s/) &&
      !lines[i].trim().match(/^\[\[DOCX_PAGE:\d+\]\]$/)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      parts.push(`<p>${escapeHtml(paragraphLines.join("\n"))}</p>`);
    }

    // Skip empty lines
    while (i < lines.length && !lines[i].trim()) {
      i++;
    }
  }

  return parts.join("\n");
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";

  const lines: string[] = [];
  const blockRegex = /<(h[1-3]|p|div|ul|ol|li|table|tr|td|th)[^>]*>[\s\S]*?<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const gap = html.slice(lastIndex, match.index).trim();
    if (gap) {
      const text = stripHtmlTags(gap).trim();
      if (text) lines.push(text);
    }

    const block = match[0];
    const tag = match[1].toLowerCase();

    if (tag === "div" && block.includes("data-page-break")) {
      const pageMatch = block.match(/data-page="(\d+)"/);
      const pageNum = pageMatch ? pageMatch[1] : "1";
      lines.push(`[[DOCX_PAGE:${pageNum}]]`);
    } else if (tag === "h1" || tag === "h2" || tag === "h3") {
      const level = parseInt(tag[1]);
      const content = stripHtmlTags(block).trim();
      if (content) {
        lines.push(`${"#".repeat(level)} ${content}`);
      }
    } else if (tag === "p") {
      const content = stripHtmlTags(block).trim();
      if (content) lines.push(content);
    }
    // Skip ul, ol, li, table etc. — text content is captured via <p> children

    lastIndex = match.index + block.length;
  }

  const trailing = html.slice(lastIndex).trim();
  if (trailing) {
    const text = stripHtmlTags(trailing).trim();
    if (text) lines.push(text);
  }

  return lines.join("\n\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}
