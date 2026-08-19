#!/usr/bin/env python3
"""
Convert plain-text contract documents into properly structured, realistic-looking legal PDFs.
"""

import os
import re
import glob
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak, HRFlowable
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# Register system TrueType Times New Roman for full Unicode support
pdfmetrics.registerFont(TTFont('TimesNewRoman', '/System/Library/Fonts/Supplemental/Times New Roman.ttf'))
pdfmetrics.registerFont(TTFont('TimesNewRoman-Bold', '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'))
pdfmetrics.registerFont(TTFont('TimesNewRoman-Italic', '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf'))
pdfmetrics.registerFont(TTFont('TimesNewRoman-BoldItalic', '/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf'))

registerFontFamily(
    'TimesNewRoman',
    normal='TimesNewRoman',
    bold='TimesNewRoman-Bold',
    italic='TimesNewRoman-Italic',
    boldItalic='TimesNewRoman-BoldItalic'
)

class LegalDocCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute total pages and render running headers/footers.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.doc_title = ""
        self.running_header = ""

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_header_footer(self, page_count):
        self.saveState()
        
        # 1 inch margins = 72 pt
        # Letter: 612 x 792 pt
        left_margin = 72
        right_margin = 612 - 72
        page_w = 612
        page_h = 792
        
        # Running Header (on every page after page 1)
        if self._pageNumber > 1:
            self.setFont("TimesNewRoman-Italic", 8.5)
            self.setFillColor(colors.HexColor("#2A2A2A"))
            
            header_text = self.running_header or self.doc_title
            # Truncate if excessively long
            if len(header_text) > 90:
                header_text = header_text[:87] + "..."
            self.drawString(left_margin, page_h - 45, header_text)
            
            # Subtle header rule
            self.setStrokeColor(colors.HexColor("#888888"))
            self.setLineWidth(0.6)
            self.line(left_margin, page_h - 50, right_margin, page_h - 50)
            
        # Running Footer (all pages)
        # Left side: CONFIDENTIAL
        self.setFont("TimesNewRoman-Bold", 8.5)
        self.setFillColor(colors.HexColor("#444444"))
        self.drawString(left_margin, 38, "CONFIDENTIAL")
        
        # Center: Page X of Y
        self.setFont("TimesNewRoman", 9)
        self.setFillColor(colors.HexColor("#222222"))
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawCentredString(page_w / 2.0, 38, page_str)
        
        # Subtle footer line
        self.setStrokeColor(colors.HexColor("#CCCCCC"))
        self.setLineWidth(0.5)
        self.line(left_margin, 50, right_margin, 50)
        
        self.restoreState()


def get_legal_styles():
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'LegalTitle',
        parent=styles['Normal'],
        fontName='TimesNewRoman-Bold',
        fontSize=14,
        leading=18,
        alignment=1,  # Centered
        spaceAfter=14,
        textColor=colors.HexColor("#0A0A0A")
    )
    
    subtitle_style = ParagraphStyle(
        'LegalSubtitle',
        parent=styles['Normal'],
        fontName='TimesNewRoman-Italic',
        fontSize=10.5,
        leading=14.5,
        alignment=1,  # Centered
        spaceAfter=12,
        textColor=colors.HexColor("#222222")
    )

    heading_style = ParagraphStyle(
        'LegalHeading',
        parent=styles['Normal'],
        fontName='TimesNewRoman-Bold',
        fontSize=11,
        leading=15,
        alignment=0,  # Left
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
        textColor=colors.HexColor("#0A0A0A")
    )

    body_style = ParagraphStyle(
        'LegalBody',
        parent=styles['Normal'],
        fontName='TimesNewRoman',
        fontSize=11,
        leading=15,
        alignment=4,  # Justified
        spaceAfter=8,
        textColor=colors.HexColor("#111111")
    )

    body_left_style = ParagraphStyle(
        'LegalBodyLeft',
        parent=styles['Normal'],
        fontName='TimesNewRoman',
        fontSize=11,
        leading=15,
        alignment=0,  # Left
        spaceAfter=8,
        textColor=colors.HexColor("#111111")
    )

    list_item_style = ParagraphStyle(
        'LegalListItem',
        parent=styles['Normal'],
        fontName='TimesNewRoman',
        fontSize=11,
        leading=15,
        leftIndent=20,
        spaceAfter=5,
        textColor=colors.HexColor("#111111")
    )

    witness_style = ParagraphStyle(
        'LegalWitness',
        parent=styles['Normal'],
        fontName='TimesNewRoman-Italic',
        fontSize=11,
        leading=15,
        spaceBefore=12,
        spaceAfter=10,
        keepWithNext=True,
        textColor=colors.HexColor("#111111")
    )

    sig_cell_style = ParagraphStyle(
        'SigCell',
        parent=styles['Normal'],
        fontName='TimesNewRoman',
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#111111")
    )

    sig_bold_style = ParagraphStyle(
        'SigBold',
        parent=styles['Normal'],
        fontName='TimesNewRoman-Bold',
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#111111")
    )

    return {
        'title': title_style,
        'subtitle': subtitle_style,
        'heading': heading_style,
        'body': body_style,
        'body_left': body_left_style,
        'list_item': list_item_style,
        'witness': witness_style,
        'sig_cell': sig_cell_style,
        'sig_bold': sig_bold_style
    }


def clean_text_for_xml(text):
    """Escape XML chars while preserving safe formatting."""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    return text


def format_inline_bold(text):
    """
    Bold initial clause numbers/headers:
    - "1. TERM." -> "<b>1. TERM.</b>"
    - "P.1.1 A320-family aircraft:" -> "<b>P.1.1 A320-family aircraft:</b>"
    - "(a)" -> "<b>(a)</b>"
    - "D1 —" -> "<b>D1 —</b>"
    - "INSURED:" -> "<b>INSURED:</b>"
    - "Solstice Project Manager:" -> "<b>Solstice Project Manager:</b>"
    - "WHEREAS" -> "<b>WHEREAS</b>"
    - "NOW THEREFORE" -> "<b>NOW THEREFORE</b>"
    """
    # 1. Numbered clauses like "1. TERM. This..." or "9A. DATA SECURITY. A..."
    m = re.match(r'^(\d+[A-Z]?\.\s+[A-Z0-9\s,/-]+\.)\s*(.*)$', text)
    if m:
        return f"<b>{m.group(1)}</b> {m.group(2)}"
        
    # 2. Rate / sub-clause items like "P.1.1 A320-family aircraft: EUR 1,850..."
    m = re.match(r'^(P\.\d+\.\d+\s+[^:]+:)\s*(.*)$', text)
    if m:
        return f"<b>{m.group(1)}</b> {m.group(2)}"
        
    # 3. P.1, P.2 items like "P.1 — STANDARD TURNAROUND RATES"
    m = re.match(r'^(P\.\d+\s+[—-]\s+[^:]+?)$', text)
    if m:
        return f"<b>{m.group(1)}</b>"

    # 4. Bullet with bold lead-in like "- Priority 1 (P1) incidents: acknowledged..." or "- Commercial General Liability: USD..."
    m = re.match(r'^([•\-–—]\s+)([^:]+:)\s*(.*)$', text)
    if m:
        return f"{m.group(1)}<b>{m.group(2)}</b> {m.group(3)}"
        
    # 5. Deliverable markers like "D1 — Discovery and requirements..."
    m = re.match(r'^([A-Z]\d+\s+[—-]\s+)(.*)$', text)
    if m:
        return f"<b>{m.group(1)}</b>{m.group(2)}"
        
    # 6. Lettered sub-clauses like "(a) Deliverable D2..."
    m = re.match(r'^(\([a-z0-9]+\))\s*(.*)$', text)
    if m:
        return f"<b>{m.group(1)}</b> {m.group(2)}"
        
    # 7. Key-value labels like "INSURED:", "ADDITIONAL INSURED:", "Solstice IT Manager:", etc.
    m = re.match(r'^([A-Z][a-zA-Z0-9\s/&,.-]+?:)\s*(.*)$', text)
    if m and len(m.group(1)) < 45 and not m.group(1).startswith("http"):
        return f"<b>{m.group(1)}</b> {m.group(2)}"
        
    # 8. Recitals
    if text.startswith("WHEREAS "):
        return f"<b>WHEREAS</b> {text[8:]}"
    if text.startswith("NOW THEREFORE "):
        return f"<b>NOW THEREFORE</b> {text[14:]}"
        
    return text


def build_pdf_from_txt(txt_path, pdf_path):
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.splitlines()
    
    # Strip leading [Suggested upload date: ...] if present
    content_lines = []
    for line in lines:
        if line.strip().startswith("[Suggested upload date:"):
            continue
        content_lines.append(line)
        
    raw_text = "\n".join(content_lines).strip()
    raw_blocks = [b.strip() for b in re.split(r'\n\s*\n', raw_text) if b.strip()]
    
    if not raw_blocks:
        return

    # Extract Document Title (first block)
    doc_title = raw_blocks[0]
    
    # Determine running header text from document heading / first line
    # If block 1 starts with "Annex ...", "Statement of Work ...", "Amendment ...", "Change Order ...", use that
    running_header = doc_title.replace("\n", " ")
    if len(raw_blocks) > 1:
        first_p = raw_blocks[1].splitlines()[0].strip()
        if (first_p.startswith("Annex ") or 
            first_p.startswith("Statement of Work ") or 
            first_p.startswith("Amendment ") or 
            first_p.startswith("Change Order ") or
            first_p.startswith("Data Processing Addendum") or
            first_p.startswith("Exhibit ")):
            # Use this descriptive title if clean
            if len(first_p) > len(running_header):
                running_header = first_p
                # Strip trailing period or parens if clean
                if running_header.endswith("."):
                    running_header = running_header[:-1]

    styles = get_legal_styles()
    story = []
    
    # Document Title centered at the top of page 1
    story.append(Paragraph(clean_text_for_xml(doc_title), styles['title']))
    
    i = 1
    num_blocks = len(raw_blocks)
    
    # Check if last block is a signature block
    has_sig_block = False
    sig_block_index = -1
    
    for idx in range(num_blocks - 1, 0, -1):
        block = raw_blocks[idx]
        if "For " in block and ("Name:" in block or "Title:" in block):
            has_sig_block = True
            sig_block_index = idx
            break

    # Also check if last block is a single-signatory letter closing (e.g. 09_TerminationNotice.txt)
    is_letter_closing = False
    if not has_sig_block:
        last_block = raw_blocks[-1]
        if last_block.startswith("Sincerely,") or "Authorized Representative:" in last_block:
            is_letter_closing = True
            
    while i < num_blocks:
        # Check if this block is the two-column signature block
        if has_sig_block and i == sig_block_index:
            sig_block = raw_blocks[i]
            
            sig_lines = [l for l in sig_block.splitlines() if l.strip()]
            
            left_col = []
            right_col = []
            
            for sline in sig_lines:
                parts = re.split(r'\s{2,}', sline.strip(), maxsplit=1)
                if len(parts) == 2:
                    left_col.append(parts[0].strip())
                    right_col.append(parts[1].strip())
                elif len(parts) == 1:
                    left_col.append(parts[0].strip())
                    right_col.append("")
            
            left_party = left_col[0] if len(left_col) > 0 else ""
            right_party = right_col[0] if len(right_col) > 0 else ""
            
            left_name = left_col[1] if len(left_col) > 1 else ""
            right_name = right_col[1] if len(right_col) > 1 else ""
            
            left_title = left_col[2] if len(left_col) > 2 else ""
            right_title = right_col[2] if len(right_col) > 2 else ""
            
            table_data = [
                [Paragraph(clean_text_for_xml(left_party), styles['sig_bold']),
                 Paragraph(clean_text_for_xml(right_party), styles['sig_bold'])],
                
                [Paragraph("<br/><br/>By: _____________________________________", styles['sig_cell']),
                 Paragraph("<br/><br/>By: _____________________________________", styles['sig_cell'])],
                
                [Paragraph(clean_text_for_xml(left_name), styles['sig_cell']),
                 Paragraph(clean_text_for_xml(right_name), styles['sig_cell'])],
                
                [Paragraph(clean_text_for_xml(left_title), styles['sig_cell']),
                 Paragraph(clean_text_for_xml(right_title), styles['sig_cell'])],
            ]
            
            for extra_idx in range(3, max(len(left_col), len(right_col))):
                l_txt = left_col[extra_idx] if extra_idx < len(left_col) else ""
                r_txt = right_col[extra_idx] if extra_idx < len(right_col) else ""
                table_data.append([
                    Paragraph(clean_text_for_xml(l_txt), styles['sig_cell']),
                    Paragraph(clean_text_for_xml(r_txt), styles['sig_cell'])
                ])
                
            # Column widths: 220pt each, with 28pt between or 234pt each
            sig_table = Table(table_data, colWidths=[234, 234])
            sig_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ]))
            
            story.append(Spacer(1, 10))
            story.append(KeepTogether(sig_table))
            i += 1
            continue

        block = raw_blocks[i]
        
        # Check for witness block
        if block.startswith("IN WITNESS WHEREOF"):
            clean_b = clean_text_for_xml(re.sub(r'\s+', ' ', block))
            
            # If followed immediately by signature block, bundle them together
            if has_sig_block and i + 1 == sig_block_index:
                # We will handle witness + sig together
                sig_block = raw_blocks[i + 1]
                sig_lines = [l for l in sig_block.splitlines() if l.strip()]
                
                left_col = []
                right_col = []
                for sline in sig_lines:
                    parts = re.split(r'\s{2,}', sline.strip(), maxsplit=1)
                    if len(parts) == 2:
                        left_col.append(parts[0].strip())
                        right_col.append(parts[1].strip())
                    elif len(parts) == 1:
                        left_col.append(parts[0].strip())
                        right_col.append("")
                
                table_data = [
                    [Paragraph(clean_text_for_xml(left_col[0] if len(left_col) > 0 else ""), styles['sig_bold']),
                     Paragraph(clean_text_for_xml(right_col[0] if len(right_col) > 0 else ""), styles['sig_bold'])],
                    
                    [Paragraph("<br/><br/>By: _____________________________________", styles['sig_cell']),
                     Paragraph("<br/><br/>By: _____________________________________", styles['sig_cell'])],
                    
                    [Paragraph(clean_text_for_xml(left_col[1] if len(left_col) > 1 else ""), styles['sig_cell']),
                     Paragraph(clean_text_for_xml(right_col[1] if len(right_col) > 1 else ""), styles['sig_cell'])],
                    
                    [Paragraph(clean_text_for_xml(left_col[2] if len(left_col) > 2 else ""), styles['sig_cell']),
                     Paragraph(clean_text_for_xml(right_col[2] if len(right_col) > 2 else ""), styles['sig_cell'])],
                ]
                
                for extra_idx in range(3, max(len(left_col), len(right_col))):
                    l_txt = left_col[extra_idx] if extra_idx < len(left_col) else ""
                    r_txt = right_col[extra_idx] if extra_idx < len(right_col) else ""
                    table_data.append([
                        Paragraph(clean_text_for_xml(l_txt), styles['sig_cell']),
                        Paragraph(clean_text_for_xml(r_txt), styles['sig_cell'])
                    ])
                    
                sig_table = Table(table_data, colWidths=[234, 234])
                sig_table.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                    ('TOPPADDING', (0, 0), (-1, -1), 2),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                ]))
                
                witness_flowable = Paragraph(clean_b, styles['witness'])
                story.append(KeepTogether([witness_flowable, Spacer(1, 10), sig_table]))
                i += 2
                continue
            else:
                story.append(Paragraph(clean_b, styles['witness']))
                i += 1
                continue
                
        # Check for Standalone Section Heading (e.g. "SECTION 1 — ...", "P.1 — ...")
        block_lines = block.splitlines()
        if (re.match(r'^(SECTION\s+\d+|P\.\d+)\s+[—-]', block, re.IGNORECASE) or 
            re.match(r'^(WHEREAS|NOW THEREFORE)', block)):
            
            if len(block_lines) > 1 and re.match(r'^(SECTION\s+\d+|P\.\d+)\s+[—-]', block_lines[0], re.IGNORECASE):
                heading_line = block_lines[0].strip()
                body_lines = " ".join([l.strip() for l in block_lines[1:] if l.strip()])
                
                story.append(Paragraph(clean_text_for_xml(heading_line), styles['heading']))
                if body_lines:
                    story.append(Paragraph(clean_text_for_xml(body_lines), styles['body']))
                i += 1
                continue
                
        # Check for Multi-line block with list items or sub-clauses
        first_line = block_lines[0].strip()
        if len(block_lines) > 1 and (
            re.match(r'^\d+\.\s+[A-Z\s,/-]+\.?$', first_line) or
            re.match(r'^[A-Z\s]+:$', first_line) or
            re.match(r'^SECTION\s+\d+\s+—', first_line)
        ):
            story.append(Paragraph(clean_text_for_xml(first_line), styles['heading']))
            
            current_item = []
            for subline in block_lines[1:]:
                sub_s = subline.strip()
                if not sub_s:
                    continue
                if (re.match(r'^\([a-z0-9]+\)', sub_s) or 
                    re.match(r'^[A-Z]\d+\s+[—-]', sub_s) or
                    re.match(r'^[•\-–—]\s+', sub_s) or
                    re.match(r'^[A-Z][a-zA-Z\s]+:', sub_s)):
                    
                    if current_item:
                        item_text = " ".join(current_item)
                        story.append(Paragraph(format_inline_bold(clean_text_for_xml(item_text)), styles['list_item']))
                        current_item = []
                    current_item.append(sub_s)
                else:
                    current_item.append(sub_s)
                        
            if current_item:
                item_text = " ".join(current_item)
                story.append(Paragraph(format_inline_bold(clean_text_for_xml(item_text)), styles['list_item']))
                
            i += 1
            continue

        # Check for single-signatory letter closing (e.g. Termination Notice)
        if block.startswith("Sincerely,"):
            clean_lines = [l.strip() for l in block_lines if l.strip()]
            closing_flowables = [
                Paragraph("Sincerely,", styles['body_left']),
                Spacer(1, 15),
                Paragraph("_____________________________________", styles['body_left'])
            ]
            for cl in clean_lines[1:]:
                closing_flowables.append(Paragraph(clean_text_for_xml(cl), styles['body_left']))
            story.append(KeepTogether(closing_flowables))
            i += 1
            continue

        # Check for Authorized Representative in Certificate of Insurance
        if "Authorized Representative:" in block:
            auth_flowables = [
                Spacer(1, 10),
                Paragraph("<b>Authorized Representative:</b>", styles['body_left']),
                Spacer(1, 15),
                Paragraph("_____________________________________", styles['body_left']),
                Paragraph(clean_text_for_xml(block.replace("Authorized Representative:", "").strip()), styles['body_left'])
            ]
            story.append(KeepTogether(auth_flowables))
            i += 1
            continue

        # General single or multi-line paragraph
        single_p = " ".join([l.strip() for l in block_lines if l.strip()])
        formatted_p = format_inline_bold(clean_text_for_xml(single_p))
        
        # Check alignment
        if (single_p.startswith("Date:") or 
            single_p.startswith("Dated:") or 
            single_p.startswith("Issued:") or 
            single_p.startswith("To:") or 
            single_p.startswith("From:") or 
            single_p.startswith("Re:") or 
            single_p.startswith("Dear ") or 
            single_p.startswith("Issuing Broker:")):
            
            if len(block_lines) > 1:
                for bline in block_lines:
                    if bline.strip():
                        story.append(Paragraph(format_inline_bold(clean_text_for_xml(bline.strip())), styles['body_left']))
            else:
                story.append(Paragraph(formatted_p, styles['body_left']))
        else:
            story.append(Paragraph(formatted_p, styles['body']))
            
        i += 1
        
    # Build Document
    # Page setup: US Letter, 1-inch margins (72pt)
    # topMargin = 60, bottomMargin = 55 ensures printable text area does not collide with header/footer
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        leftMargin=72,
        rightMargin=72,
        topMargin=60,
        bottomMargin=55
    )
    
    def canvas_factory(*args, **kwargs):
        c = LegalDocCanvas(*args, **kwargs)
        c.doc_title = doc_title.splitlines()[0].strip()
        c.running_header = running_header
        return c
        
    doc.build(story, canvasmaker=canvas_factory)


def main():
    base_dir = "/Users/sambhavjain/Desktop/Codes/extractor/extractor/sample_projects"
    txt_files = sorted(glob.glob(f"{base_dir}/**/*.txt", recursive=True))
    
    print(f"Found {len(txt_files)} txt files to convert.")
    for txt_path in txt_files:
        pdf_path = os.path.splitext(txt_path)[0] + ".pdf"
        print(f"Converting: {os.path.basename(txt_path)} -> {os.path.basename(pdf_path)}")
        build_pdf_from_txt(txt_path, pdf_path)
    print("All PDFs successfully generated!")

if __name__ == "__main__":
    main()
