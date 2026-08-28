#!/usr/bin/env python3
"""
Generator for synthetic IATA AHM 810 Test Corpus (v2).

Key v2 Updates:
  1. Header rename (SGHA 2018 -> SGHA Ref) scoped strictly to C's ramp_services only.
     support_services and passenger_services headers in C remain 'SGHA 2018' so M5 stays clean.
     signature_should_match: false and fuzzy_should_match: true for C's ramp_services.
  2. Document D's passenger_services is a complete 12-row copy of Document A's schedule (values identical).
  3. Every row in passenger_services carried forward across B (12 rows) and C (12 rows) with exact 3.00% indexation.
     Row counts only change where M4 (+1 row in C's ramp) and M5 (-1 row in C's support) dictate.
"""

import os
import sys
import json
from decimal import Decimal, ROUND_HALF_UP
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# Register system TrueType fonts for full Unicode / Greek / German support
TIMES_REG = '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
TIMES_BOLD = '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'
TIMES_ITALIC = '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf'
TIMES_BOLDITALIC = '/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf'

if os.path.exists(TIMES_REG):
    pdfmetrics.registerFont(TTFont('TimesNewRoman', TIMES_REG))
    pdfmetrics.registerFont(TTFont('TimesNewRoman-Bold', TIMES_BOLD))
    pdfmetrics.registerFont(TTFont('TimesNewRoman-Italic', TIMES_ITALIC))
    pdfmetrics.registerFont(TTFont('TimesNewRoman-BoldItalic', TIMES_BOLDITALIC))
    registerFontFamily(
        'TimesNewRoman',
        normal='TimesNewRoman',
        bold='TimesNewRoman-Bold',
        italic='TimesNewRoman-Italic',
        boldItalic='TimesNewRoman-BoldItalic'
    )
    FONT_NORMAL = 'TimesNewRoman'
    FONT_BOLD = 'TimesNewRoman-Bold'
    FONT_ITALIC = 'TimesNewRoman-Italic'
    FONT_BOLDITALIC = 'TimesNewRoman-BoldItalic'
else:
    FONT_NORMAL = 'Times-Roman'
    FONT_BOLD = 'Times-Bold'
    FONT_ITALIC = 'Times-Italic'
    FONT_BOLDITALIC = 'Times-BoldItalic'


def cpi_uplift_str(price_str):
    """
    Applies +3.00% CPI indexation with ROUND_HALF_UP and returns formatted EUR string.
    """
    if not price_str or not isinstance(price_str, str):
        return price_str
    if "EUR" not in price_str:
        return price_str
    num_part = price_str.replace("EUR", "").strip().replace(",", "")
    try:
        val = Decimal(num_part)
        uplifted = (val * Decimal('1.03')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return f"{uplifted:.2f} EUR"
    except Exception:
        return price_str


class SyntheticDocCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute total pages and draw headers/footers.
    Strictly draws SYNTHETIC TEST DOCUMENT — NOT A REAL AGREEMENT in footer of every page.
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
        left_margin = 54   # 0.75 in
        right_margin = 612 - 54
        page_w = 612
        page_h = 792

        # Running Header (pages > 1)
        if self._pageNumber > 1:
            self.setFont(FONT_ITALIC, 8.5)
            self.setFillColor(colors.HexColor("#333333"))
            header_text = self.running_header or self.doc_title
            if len(header_text) > 85:
                header_text = header_text[:82] + "..."
            self.drawString(left_margin, page_h - 38, header_text)
            self.setStrokeColor(colors.HexColor("#888888"))
            self.setLineWidth(0.5)
            self.line(left_margin, page_h - 43, right_margin, page_h - 43)

        # Running Footer (EVERY page)
        self.setFont(FONT_BOLD, 8.5)
        self.setFillColor(colors.HexColor("#7A1C1C"))
        self.drawString(left_margin, 34, "SYNTHETIC TEST DOCUMENT — NOT A REAL AGREEMENT")

        # Page numbering
        self.setFont(FONT_NORMAL, 8.5)
        self.setFillColor(colors.HexColor("#222222"))
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(right_margin, 34, page_str)

        # Footer dividing line
        self.setStrokeColor(colors.HexColor("#CCCCCC"))
        self.setLineWidth(0.5)
        self.line(left_margin, 46, right_margin, 46)

        self.restoreState()


def get_styles():
    styles = getSampleStyleSheet()
    
    body = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName=FONT_NORMAL,
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#1A1A1A"),
        spaceAfter=4
    )
    
    doc_title = ParagraphStyle(
        'DocTitleStyle',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=12.5,
        leading=15.5,
        alignment=1, # Center
        textColor=colors.HexColor("#0D233A"),
        spaceAfter=2
    )

    doc_subtitle = ParagraphStyle(
        'DocSubTitleStyle',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=9.5,
        leading=12.5,
        alignment=1, # Center
        textColor=colors.HexColor("#2C4D6F"),
        spaceAfter=6
    )

    sec_heading = ParagraphStyle(
        'DocSecHeading',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=9.5,
        leading=12.5,
        textColor=colors.HexColor("#0D233A"),
        spaceBefore=5,
        spaceAfter=2.5,
        keepWithNext=True
    )

    sub_heading = ParagraphStyle(
        'DocSubHeading',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#1A2B4C"),
        spaceBefore=4,
        spaceAfter=2,
        keepWithNext=True
    )

    hanging_clause = ParagraphStyle(
        'DocHangingClause',
        parent=styles['Normal'],
        fontName=FONT_NORMAL,
        fontSize=8,
        leading=10.8,
        leftIndent=22,
        firstLineIndent=-22,
        spaceAfter=3,
        textColor=colors.HexColor("#1A1A1A")
    )

    tbl_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName=FONT_NORMAL,
        fontSize=7.5,
        leading=9.8,
        textColor=colors.HexColor("#1A1A1A")
    )

    tbl_cell_bold = ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=7.5,
        leading=9.8,
        textColor=colors.HexColor("#0D233A")
    )

    tbl_hdr = ParagraphStyle(
        'TableHdr',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=7.5,
        leading=9.8,
        textColor=colors.HexColor("#FFFFFF")
    )

    tbl_banner = ParagraphStyle(
        'TableBanner',
        parent=styles['Normal'],
        fontName=FONT_BOLD,
        fontSize=8.5,
        leading=11,
        alignment=1, # Center
        textColor=colors.HexColor("#FFFFFF")
    )

    return {
        'body': body,
        'doc_title': doc_title,
        'doc_subtitle': doc_subtitle,
        'sec_heading': sec_heading,
        'sub_heading': sub_heading,
        'hanging_clause': hanging_clause,
        'tbl_cell': tbl_cell,
        'tbl_cell_bold': tbl_cell_bold,
        'tbl_hdr': tbl_hdr,
        'tbl_banner': tbl_banner
    }


def make_table(data, col_widths, is_banner=False, is_ruled=True, empty_corner=False, custom_bg=None, repeat_rows=1):
    """
    Constructs a ReportLab Table with consistent legal styling.
    """
    styles = get_styles()
    formatted_data = []
    
    for r_idx, row in enumerate(data):
        formatted_row = []
        for c_idx, cell in enumerate(row):
            if isinstance(cell, Paragraph):
                formatted_row.append(cell)
            elif cell is None:
                formatted_row.append(Paragraph("", styles['tbl_cell']))
            else:
                s_cell = str(cell)
                if "\n" in s_cell:
                    s_cell = s_cell.replace("\n", "<br/>")

                if is_banner and r_idx == 0:
                    formatted_row.append(Paragraph(s_cell, styles['tbl_banner']))
                elif (is_banner and r_idx == 1) or (not is_banner and r_idx == 0):
                    if empty_corner and r_idx == 0 and c_idx == 0 and s_cell == "":
                        formatted_row.append(Paragraph("", styles['tbl_hdr']))
                    else:
                        formatted_row.append(Paragraph(s_cell, styles['tbl_hdr']))
                else:
                    if c_idx == 0 and not is_ruled:
                        formatted_row.append(Paragraph(s_cell, styles['tbl_cell_bold']))
                    else:
                        formatted_row.append(Paragraph(s_cell, styles['tbl_cell']))
        formatted_data.append(formatted_row)

    t_style = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2.2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
        ('LEFTPADDING', (0, 0), (-1, -1), 3.5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3.5),
    ]

    header_row_idx = 1 if is_banner else 0

    if is_banner:
        t_style.append(('SPAN', (0, 0), (-1, 0)))
        t_style.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1A3A5C")))
        t_style.append(('BACKGROUND', (0, 1), (-1, 1), colors.HexColor("#2C4D6F")))
    else:
        t_style.append(('BACKGROUND', (0, 0), (-1, 0), custom_bg or colors.HexColor("#2C4D6F")))

    if is_ruled:
        t_style.extend([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#C0C0C0")),
            ('BOX', (0, 0), (-1, -1), 1.0, colors.HexColor("#1A3A5C")),
        ])
        start_row = 2 if is_banner else 1
        for i in range(start_row, len(data)):
            if i % 2 == 1:
                t_style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor("#F7F9FB")))
    else:
        t_style.extend([
            ('LINEBELOW', (0, header_row_idx), (-1, header_row_idx), 0.8, colors.HexColor("#2C4D6F")),
            ('LINEBELOW', (0, -1), (-1, -1), 0.5, colors.HexColor("#888888")),
        ])

    table = Table(formatted_data, colWidths=col_widths, repeatRows=repeat_rows)
    table.setStyle(TableStyle(t_style))
    return table


# ==========================================
# MASTER RATE SCHEDULE DATA DEFINITIONS
# ==========================================

# 1. Tiered Handling Charges (4 rows across A, B, C)
TIERED_CHARGES_A = [
    ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
    ["≤ 3,000 kg", "180.00 EUR", "Ramp marshalling, baggage offloading, chock placement"],
    ["3,001 – 20,000 kg", "420.00 EUR", "Full ramp attendance, passenger step positioning, ground power 30 min"],
    ["20,001 – 60,000 kg", "850.00 EUR", "Complete turnaround handling, load sheet, baggage sorting, water/toilet"],
    ["> 60,000 kg", "1450.00 EUR", "Wide-body ramp supervision, two ASU connections, multi-crew dispatch"]
]

TIERED_CHARGES_B = [
    ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
    ["≤ 3,000 kg", "185.40 EUR", "Ramp marshalling, baggage offloading, chock placement"],
    ["3,001 – 20,000 kg", "432.60 EUR", "Full ramp attendance, passenger step positioning, ground power 30 min"],
    ["20,001 – 60,000 kg", "875.50 EUR", "Complete turnaround handling, load sheet, baggage sorting, water/toilet"],
    ["> 60,000 kg", "1493.50 EUR", "Wide-body ramp supervision, two ASU connections, multi-crew dispatch"]
]

TIERED_CHARGES_C = [
    ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
    ["≤ 3,000 kg", "190.96 EUR", "Ramp marshalling, baggage offloading, chock placement"],
    ["3,001 – 20,000 kg", "445.58 EUR", "Full ramp attendance, passenger step positioning, ground power 30 min"],
    ["20,001 – 60,000 kg", "901.77 EUR", "Complete turnaround handling, load sheet, baggage sorting, water/toilet"],
    ["> 60,000 kg", "1538.31 EUR", "Wide-body ramp supervision, two ASU connections, multi-crew dispatch"]
]

# 2. Ramp Services Rate Card
RAMP_COLS = [190, 95, 95, 124]

# Doc A: 8 rows
RAMP_ROWS_A = [
    ["RAMP SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["MARSHALLING", "PER FLIGHT", "FREE", "3.2.1(a)"],
    ["GPU (GROUND POWER UNIT)", "PER HOUR", "45.00 EUR", "3.6.1(a)"],
    ["ASU (AIR START UNIT)", "PER ATTEMPT", "120.00 EUR", "3.6.1(b)"],
    ["PUSHBACK TRACTOR & CREW", "PER OPERATION", "110.00 EUR", "3.9.2(a)"],
    ["HEADSET COMMUNICATION", "PER FLIGHT", "FREE", "3.9.3(a)"],
    ["POTABLE WATER SERVICE", "PER SERVICE", "55.00 EUR", "3.11.1"],
    ["TOILET SERVICING", "PER SERVICE", "65.00 EUR", "3.11.2"],
    ["CABIN CLEANING — TRANSIT", "PER TURNAROUND", "180.00 EUR", "3.13.1"]
]

# Doc B: 8 rows (M1 clean uplift)
RAMP_ROWS_B = [
    ["RAMP SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["MARSHALLING", "PER FLIGHT", "FREE", "3.2.1(a)"],
    ["GPU (GROUND POWER UNIT)", "PER HOUR", "46.35 EUR", "3.6.1(a)"],
    ["ASU (AIR START UNIT)", "PER ATTEMPT", "123.60 EUR", "3.6.1(b)"],
    ["PUSHBACK TRACTOR & CREW", "PER OPERATION", "113.30 EUR", "3.9.2(a)"],
    ["HEADSET COMMUNICATION", "PER FLIGHT", "FREE", "3.9.3(a)"],
    ["POTABLE WATER SERVICE", "PER SERVICE", "56.65 EUR", "3.11.1"],
    ["TOILET SERVICING", "PER SERVICE", "66.95 EUR", "3.11.2"],
    ["CABIN CLEANING — TRANSIT", "PER TURNAROUND", "185.40 EUR", "3.13.1"]
]

# Doc C: 9 rows (M2 compounded, M4 row added, M6 column renamed SGHA Ref ONLY in C's ramp)
RAMP_ROWS_C = [
    ["RAMP SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA Ref"],  # M6: SGHA Ref ONLY here!
    ["MARSHALLING", "PER FLIGHT", "FREE", "3.2.1(a)"],
    ["GPU (GROUND POWER UNIT)", "PER HOUR", "47.74 EUR", "3.6.1(a)"],
    ["ASU (AIR START UNIT)", "PER ATTEMPT", "127.31 EUR", "3.6.1(b)"],
    ["PUSHBACK TRACTOR & CREW", "PER OPERATION", "116.70 EUR", "3.9.2(a)"],
    ["HEADSET COMMUNICATION", "PER FLIGHT", "FREE", "3.9.3(a)"],
    ["POTABLE WATER SERVICE", "PER SERVICE", "58.35 EUR", "3.11.1"],
    ["TOILET SERVICING", "PER SERVICE", "68.96 EUR", "3.11.2"],
    ["CABIN CLEANING — TRANSIT", "PER TURNAROUND", "190.96 EUR", "3.13.1"],
    ["ELECTRIC TOWBARLESS TRACTOR", "PER OPERATION", "140.00 EUR", "3.9.2(c)"]  # M4 added row
]

# 3. Support Services Rate Card
SUPPORT_COLS = [190, 95, 95, 124]

# Doc A: 6 rows
SUPPORT_ROWS_A = [
    ["SUPPORT SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["UNIT LOAD DEVICE (ULD) CONTROL", "PER FLIGHT", "35.00 EUR", "6.2.1(a)"],
    ["CREW TRANSPORT — AIRSIDE", "PER VEHICLE TRIP", "40.00 EUR", "6.3.2(a)"],
    ["CREW TRANSPORT — OFF-AIRPORT", "PER TRIP", "75.00 EUR", "6.3.2(b)"],
    ["LOAD CONTROL / WEIGHT & BALANCE", "PER FLIGHT", "90.00 EUR", "6.7.1"],
    ["COMMUNICATIONS (SITA / ARINC)", "PER MESSAGE", "at cost", "6.8.1"],
    ["SECURITY WATCH (AIRSIDE)", "PER MAN-HOUR", "32.00 EUR", "6.9.1"]
]

# Doc B: 6 rows (pure uplift)
SUPPORT_ROWS_B = [
    ["SUPPORT SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["UNIT LOAD DEVICE (ULD) CONTROL", "PER FLIGHT", "36.05 EUR", "6.2.1(a)"],
    ["CREW TRANSPORT — AIRSIDE", "PER VEHICLE TRIP", "41.20 EUR", "6.3.2(a)"],
    ["CREW TRANSPORT — OFF-AIRPORT", "PER TRIP", "77.25 EUR", "6.3.2(b)"],
    ["LOAD CONTROL / WEIGHT & BALANCE", "PER FLIGHT", "92.70 EUR", "6.7.1"],
    ["COMMUNICATIONS (SITA / ARINC)", "PER MESSAGE", "at cost", "6.8.1"],
    ["SECURITY WATCH (AIRSIDE)", "PER MAN-HOUR", "32.96 EUR", "6.9.1"]
]

# Doc C: 5 rows (M5 row removed: off-airport crew transport dropped. Header remains SGHA 2018!)
SUPPORT_ROWS_C = [
    ["SUPPORT SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],  # Header unchanged so M5 stays clean!
    ["UNIT LOAD DEVICE (ULD) CONTROL", "PER FLIGHT", "37.13 EUR", "6.2.1(a)"],
    ["CREW TRANSPORT — AIRSIDE", "PER VEHICLE TRIP", "42.44 EUR", "6.3.2(a)"],
    # CREW TRANSPORT — OFF-AIRPORT is dropped (M5)
    ["LOAD CONTROL / WEIGHT & BALANCE", "PER FLIGHT", "95.48 EUR", "6.7.1"],
    ["COMMUNICATIONS (SITA / ARINC)", "PER MESSAGE", "at cost", "6.8.1"],
    ["SECURITY WATCH (AIRSIDE)", "PER MAN-HOUR", "33.95 EUR", "6.9.1"]
]

# 4. Passenger Services Rate Card (Complete 12 rows across A, B, C, D)
PASSENGER_COLS = [190, 95, 95, 124]

# Doc A: 12 rows
PASSENGER_ROWS_A = [
    ["PASSENGER SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["CHECK-IN COUNTER STAFFING", "PER DESK / HR", "38.00 EUR", "2.1.3(a)"],
    ["BOARDING GATE MANAGEMENT", "PER FLIGHT", "85.00 EUR", "2.1.4(a)"],
    ["SPECIAL PASSENGER ASSISTANCE (PRM)", "PER PASSENGER", "22.00 EUR", "2.1.7(a)"],
    ["LOST & FOUND / BAGGAGE TRACING (WORLDTRACER)", "PER PIR FILE", "28.00 EUR", "2.2.1(a)"],
    ["TRANSIT PASSENGER ESCORT", "PER FLIGHT", "FREE", "2.1.8(b)"],
    ["VIP / LOUNGE HOSTING", "PER HOUR", "on request (R)", "2.1.9(a)"],
    ["EXCESS BAGGAGE COLLECTION", "PER TRANSACTION", "18.00 EUR", "2.1.3(c)"],
    ["UNACCOMPANIED MINOR (UM) ESCORT", "PER CHILD", "35.00 EUR", "2.1.7(c)"],
    ["STANDBY PASSENGER PROCESSING", "PER PASSENGER", "12.00 EUR", "2.1.4(d)"],
    ["DOCUMENTATION & VISA VERIFICATION", "PER PASSENGER", "FREE", "2.1.2(a)"],
    ["BAGGAGE DELIVERY TO HOTEL", "PER BAG", "45.00 EUR", "2.2.3(a)"],
    ["FLIGHT IRREGULARITY RE-BOOKING", "PER MAN-HOUR", "50.00 EUR", "2.1.6(a)"]
]

# Doc B: 12 rows (All 12 rows carried forward, 3.00% uplift)
PASSENGER_ROWS_B = [
    ["PASSENGER SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["CHECK-IN COUNTER STAFFING", "PER DESK / HR", "39.14 EUR", "2.1.3(a)"],
    ["BOARDING GATE MANAGEMENT", "PER FLIGHT", "87.55 EUR", "2.1.4(a)"],
    ["SPECIAL PASSENGER ASSISTANCE (PRM)", "PER PASSENGER", "22.66 EUR", "2.1.7(a)"],
    ["LOST & FOUND / BAGGAGE TRACING (WORLDTRACER)", "PER PIR FILE", "28.84 EUR", "2.2.1(a)"],
    ["TRANSIT PASSENGER ESCORT", "PER FLIGHT", "FREE", "2.1.8(b)"],
    ["VIP / LOUNGE HOSTING", "PER HOUR", "on request (R)", "2.1.9(a)"],
    ["EXCESS BAGGAGE COLLECTION", "PER TRANSACTION", "18.54 EUR", "2.1.3(c)"],
    ["UNACCOMPANIED MINOR (UM) ESCORT", "PER CHILD", "36.05 EUR", "2.1.7(c)"],
    ["STANDBY PASSENGER PROCESSING", "PER PASSENGER", "12.36 EUR", "2.1.4(d)"],
    ["DOCUMENTATION & VISA VERIFICATION", "PER PASSENGER", "FREE", "2.1.2(a)"],
    ["BAGGAGE DELIVERY TO HOTEL", "PER BAG", "46.35 EUR", "2.2.3(a)"],
    ["FLIGHT IRREGULARITY RE-BOOKING", "PER MAN-HOUR", "51.50 EUR", "2.1.6(a)"]
]

# Doc C: 12 rows (All 12 rows carried forward, compounded 3.00% uplift on B, header remains SGHA 2018)
PASSENGER_ROWS_C = [
    ["PASSENGER SERVICES", "", "", ""],
    ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
    ["CHECK-IN COUNTER STAFFING", "PER DESK / HR", "40.31 EUR", "2.1.3(a)"],
    ["BOARDING GATE MANAGEMENT", "PER FLIGHT", "90.18 EUR", "2.1.4(a)"],
    ["SPECIAL PASSENGER ASSISTANCE (PRM)", "PER PASSENGER", "23.34 EUR", "2.1.7(a)"],
    ["LOST & FOUND / BAGGAGE TRACING (WORLDTRACER)", "PER PIR FILE", "29.71 EUR", "2.2.1(a)"],
    ["TRANSIT PASSENGER ESCORT", "PER FLIGHT", "FREE", "2.1.8(b)"],
    ["VIP / LOUNGE HOSTING", "PER HOUR", "on request (R)", "2.1.9(a)"],
    ["EXCESS BAGGAGE COLLECTION", "PER TRANSACTION", "19.10 EUR", "2.1.3(c)"],
    ["UNACCOMPANIED MINOR (UM) ESCORT", "PER CHILD", "37.13 EUR", "2.1.7(c)"],
    ["STANDBY PASSENGER PROCESSING", "PER PASSENGER", "12.73 EUR", "2.1.4(d)"],
    ["DOCUMENTATION & VISA VERIFICATION", "PER PASSENGER", "FREE", "2.1.2(a)"],
    ["BAGGAGE DELIVERY TO HOTEL", "PER BAG", "47.74 EUR", "2.2.3(a)"],
    ["FLIGHT IRREGULARITY RE-BOOKING", "PER MAN-HOUR", "53.05 EUR", "2.1.6(a)"]
]

# Doc D: 12 rows (M3: COMPLETE 12-ROW BYTE-IDENTICAL COPY OF A)
PASSENGER_ROWS_D = PASSENGER_ROWS_A


# ==========================================
# DOCUMENT BUILDERS
# ==========================================

def build_pdf_A(output_path):
    """
    Builds Document A (Base Agreement 2022-2025).
    """
    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []

    # Title Banner
    story.append(Paragraph("STANDARD GROUND HANDLING AGREEMENT — SIMPLIFIED PROCEDURE", styles['doc_title']))
    story.append(Paragraph("ANNEX B 1.0 — LOCATION, AGREED SERVICES AND CHARGES", styles['doc_subtitle']))
    story.append(Paragraph(
        "This Annex B 1.0 is entered into as of <b>01 April 2022</b> between <b>AEROVENTURE AIRLINES S.A.</b> (\"Carrier\") "
        "and <b>NEXUS GROUND HANDLING SERVICES LTD.</b> (\"Handling Company\"), with respect to ground handling operations "
        "at <b>Athens International Airport (ATH / LGAV)</b>.",
        styles['body']
    ))
    story.append(Spacer(1, 3))

    # Table 1: Contract Metadata (Cover block, label/value pairs, no ruling lines)
    story.append(Paragraph("CONTRACT METADATA & PARTICULARS", styles['sub_heading']))
    metadata_data = [
        ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
        ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
        ["Governing Standard", "IATA Standard Ground Handling Agreement (AHM 810) — 2018 Simplified Procedure"],
        ["Location / Station", "Athens International Airport (ATH / LGAV), Spata, Attica, Greece"],
        ["Effective Period", "01 April 2022 to 31 March 2025"],
        ["Prior Agreement", "None — Initial Base Agreement (Annex B 1.0)"]
    ]
    story.append(make_table(metadata_data, [160, 344], is_ruled=False))
    story.append(Spacer(1, 4))

    # Table 2: Scope & Services Matrix (S8: Ragged rows with trailing empty cells)
    story.append(Paragraph("ANNEX A SCOPE & SERVICES MATRIX", styles['sub_heading']))
    scope_data = [
        ["Annex A Section", "Service Description", "Status", "Special Handling Notes"],
        ["Section 1.1.2", "Station Management & Local Representation", "Included", "Designated representative provided"],
        ["Section 2.1.1", "Passenger Check-in System Interface", "Included", ""],  # S8: ragged row
        ["Section 3.3.1", "Baggage Sorting and Loading", "Included", "Bulk and containerized ULD"],
        ["Section 3.6.1", "Ground Power Unit Provision (400 Hz)", "Optional / Per Use", "Subject to tariff"],
        ["Section 4.1.2", "Air Cargo Document Handling", "Excluded", ""],  # S8: ragged row
        ["Section 6.3.1", "Crew Surface Transportation (Airside)", "Included", "Apron shuttle only"]
    ]
    story.append(make_table(scope_data, [85, 185, 94, 140], is_ruled=True))
    story.append(Spacer(1, 6))

    # --- Page 2 ---
    story.append(PageBreak())
    story.append(Paragraph("PARAGRAPH 1 — HANDLING SERVICES AND CHARGES", styles['sec_heading']))
    story.append(Paragraph(
        "1.1 For the handling services listed in this Annex B, the Carrier shall pay to the Handling Company "
        "the scheduled handling charges set out in the following tables.",
        styles['body']
    ))

    # Table 3: Tiered Pricing (Basic handling charge by MTOW band)
    story.append(Paragraph("1.2 Basic Turnaround Handling Charges (Tiered by MTOW)", styles['sub_heading']))
    story.append(make_table(TIERED_CHARGES_A, [120, 110, 274], is_ruled=True))
    story.append(Spacer(1, 4))

    # Table 4: Categorized Turnaround Services (S10: Blank separator row)
    story.append(Paragraph("1.3 Standard Turnaround Package Rates", styles['sub_heading']))
    s10_data = [
        ["Aircraft Category", "Turnaround Specification", "Fixed Rate", "SGHA Ref"],
        ["Narrow-Body Aircraft", "A319 / A320 / A321 Standard Turnaround", "620.00 EUR", "3.1.1"],
        ["Narrow-Body Aircraft", "B737-700 / 800 / 900 Turnaround", "640.00 EUR", "3.1.2"],
        ["", "", "", ""],  # S10: Blank separator row
        ["Wide-Body Aircraft", "A330-200 / 300 Wide-Body Turnaround", "1250.00 EUR", "3.1.3"],
        ["Wide-Body Aircraft", "B777-200 / 300 Wide-Body Turnaround", "1420.00 EUR", "3.1.4"]
    ]
    story.append(make_table(s10_data, [130, 200, 94, 80], is_ruled=True))
    story.append(Spacer(1, 4))

    # PARAGRAPH 2 — ADDITIONAL CHARGES (S1: Hanging indent clauses 2.1-2.6, Not A Table)
    story.append(Paragraph("PARAGRAPH 2 — ADDITIONAL CHARGES", styles['sec_heading']))
    story.append(Paragraph("2.1 Additional services requested by the Carrier not specified in Paragraph 1 shall be charged at standard published tariff rates.", styles['hanging_clause']))
    story.append(Paragraph("2.2 Night operations between 23:00 and 06:00 local time shall incur a night surcharge of twenty-five per cent (25.00%) on basic handling.", styles['hanging_clause']))
    story.append(Paragraph("2.3 Turnaround extensions exceeding scheduled ground times by more than sixty (60) minutes shall be billed at 65.00 EUR per half hour.", styles['hanging_clause']))
    story.append(Paragraph("2.4 De-icing and anti-icing operations shall be performed in accordance with ICAO Doc 9640 and charged on fluid consumption basis.", styles['hanging_clause']))
    story.append(Paragraph("2.5 Pushback aborts caused by aircraft technical defects shall incur a callout fee of 75.00 EUR per occurrence.", styles['hanging_clause']))
    story.append(Paragraph("2.6 Special baggage processing for out-of-gauge items shall be subject to a fixed handling fee of 15.00 EUR per unit.", styles['hanging_clause']))
    
    # REQUIRED VERBATIM CLAUSE 2.7
    story.append(Paragraph(
        "<b>2.7 With effect from 01 April 2023 and on each anniversary thereafter, all charges set out in Paragraph 1 "
        "shall be increased by three per cent (3.00%) per annum, compounded annually, rounded to two decimal places.</b>",
        styles['hanging_clause']
    ))
    story.append(Spacer(1, 6))

    # --- Page 3 ---
    # S2 & S3: Column-aligned neighbours on the same page with merged banner cells and prose in between
    story.append(PageBreak())
    story.append(Paragraph("PARAGRAPH 1 (CONTINUED) — SPECIFIC SERVICE RATE SCHEDULES", styles['sec_heading']))
    
    # Table 5: RAMP SERVICES (S3: Merged banner cell)
    story.append(make_table(RAMP_ROWS_A, RAMP_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # S2 Prose Separator (at least 3 paragraphs separating RAMP and SUPPORT services)
    story.append(Paragraph(
        "<b>Turnaround Operational Coordination:</b> The Handling Company shall deploy adequate ramp equipment "
        "and certified ground handling personnel at the designated aircraft stand no later than ten (10) minutes "
        "prior to Estimated Time of Arrival (ETA). All ramp movements must comply with airport safety directives.",
        styles['body']
    ))
    story.append(Paragraph(
        "<b>Foreign Object Debris (FOD) Prevention:</b> Prior to aircraft arrival and immediately following departure, "
        "the ramp team leader shall execute a comprehensive FOD sweep of the aircraft parking footprint and pushback "
        "trajectory, logging the inspection in the station turnaround log.",
        styles['body']
    ))
    story.append(Paragraph(
        "<b>Communication Protocols:</b> Headset communications with the flight deck shall remain active throughout "
        "the arrival chocking sequence and the entire pushback and engine start-up procedure until ground clearance "
        "is acknowledged by the pilot-in-command.",
        styles['body']
    ))
    story.append(Spacer(1, 6))

    # Table 6: SUPPORT SERVICES (S2: Identical column positions, S3: Merged banner cell)
    story.append(make_table(SUPPORT_ROWS_A, SUPPORT_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # --- Page 4 ---
    story.append(PageBreak())
    story.append(Paragraph("PARAGRAPH 1 (CONTINUED) — PASSENGER & RESOURCING SCHEDULES", styles['sec_heading']))

    # Table 7: PASSENGER SERVICES (S5: Page-spanning table breaking into Page 5, Category: Rate Schedule, 12 rows)
    story.append(make_table(PASSENGER_ROWS_A, PASSENGER_COLS, is_banner=True, is_ruled=True, repeat_rows=2))
    story.append(Spacer(1, 6))

    # Table 8: Staffing & Resourcing (Category: Staffing & Resourcing, mix numeric and word values)
    story.append(Paragraph("1.4 Dedicated Station Staffing Allocation", styles['sub_heading']))
    staffing_data = [
        ["Position", "Number of Staff", "Man hours"],
        ["Station Duty Manager", "1", "8.0"],
        ["Ramp Team Leader / Supervisor", "1", "4.5"],
        ["Baggage Loading Agents", "4", "18.0"],
        ["Passenger Service Agents", "3", "12.0"],
        ["Load Control Officer", "centralized", "on request"],
        ["Safety & Compliance Auditor", "1", "centralized"]
    ]
    story.append(make_table(staffing_data, [180, 140, 184], is_ruled=True))
    story.append(Spacer(1, 6))

    # Table 9: Labor Overtime Surcharges (S7: Empty corner header)
    story.append(Paragraph("1.5 Supplemental Labor Hourly Overtime Rates", styles['sub_heading']))
    s7_data = [
        ["", "Straight Time", "Overtime (1.5x)", "Holiday (2.0x)"],  # S7: empty top-left
        ["Duty Manager", "45.00 EUR", "67.50 EUR", "90.00 EUR"],
        ["Ramp Agent", "28.00 EUR", "42.00 EUR", "56.00 EUR"],
        ["Passenger Service Agent", "26.00 EUR", "39.00 EUR", "52.00 EUR"],
        ["Baggage Handler", "24.00 EUR", "36.00 EUR", "48.00 EUR"]
    ]
    story.append(make_table(s7_data, [150, 115, 120, 119], is_ruled=True, empty_corner=True))
    story.append(Spacer(1, 6))

    # --- Page 5 ---
    story.append(PageBreak())
    story.append(Paragraph("PARAGRAPH 3 — DISBURSEMENTS & REGULATORY FEES", styles['sec_heading']))
    story.append(Paragraph(
        "3.1 The Handling Company shall pay on behalf of the Carrier all statutory disbursements and airport charges. "
        "Disbursements shall be reimbursed at cost plus an administrative fee.",
        styles['body']
    ))

    # Table 10: Disbursements & Regulatory Fees (S9: Mixed currency €, $, USD and non-ASCII Greek / German addresses)
    story.append(Paragraph("3.2 Regulatory Authority and Third-Party Pass-Through Fees", styles['sub_heading']))
    s9_data = [
        ["Fee Description", "Currency", "Billing Rate / Basis", "Billing Entity & Notification Address"],
        ["Airport Infrastructure Levy", "€", "14.50 per turnaround", "Athens International Airport S.A., 19019 Spata, Greece"],
        ["International Overflight Fee", "$", "25.00 USD flat", "HCAA Navigation Service, 16604 Hellinikon, Greece"],
        ["Disbursement Admin Fee", "%", "5.25% of outlay", "Nexus Ground Handling Services Ltd."],
        ["De-Icing Reserve Allocation", "USD", "500.00 USD per season", "Nexus Hub Europe — Straßburger Straße 18, 10405 Berlin"],
        ["Regional Civil Aviation Dues", "€", "18.00 EUR per flight", "Hellenic CAA — Λεωφόρος Βασιλέως Κωνσταντίνου 44, 11635 Αθήνα"]
    ]
    story.append(make_table(s9_data, [140, 50, 114, 200], is_ruled=True))
    story.append(Spacer(1, 6))

    # Table 11: Supplemental Ground Equipment Rates (S6: Unruled aligned list)
    story.append(Paragraph("PARAGRAPH 3.3 SUPPLEMENTAL GROUND EQUIPMENT RATES", styles['sub_heading']))
    s6_data = [
        ["Equipment Description", "Standard Hourly Rate"],
        ["GPU Air Start Unit (ASU)", "140.00 EUR"],
        ["Cabin Air Heater / Air Conditioner Unit", "95.00 EUR"],
        ["Mobile Passenger Boarding Stairs (Towable)", "60.00 EUR"],
        ["Main Deck Cargo Loader (High-Loader)", "210.00 EUR"],
        ["Belt Loader (Self-Propelled)", "55.00 EUR"]
    ]
    story.append(make_table(s6_data, [300, 204], is_ruled=False))
    story.append(Spacer(1, 6))

    # PARAGRAPH 4 — STANDARD OF WORK
    story.append(Paragraph("PARAGRAPH 4 — STANDARD OF WORK & PERFORMANCE BENCHMARKS", styles['sec_heading']))
    
    # Table 12: SLA / Performance Target
    story.append(Paragraph("4.1 Service Level Agreement (SLA) Performance Standards", styles['sub_heading']))
    sla_data = [
        ["Metric", "Target", "Measurement Window"],
        ["First Bag on Carousel", "≤ 15 minutes after on-chocks", "Per flight turnaround"],
        ["Last Bag on Carousel", "≤ 35 minutes after on-chocks", "Per flight turnaround"],
        ["On-Time Ground Despatch", "≥ 99.2% departures", "Monthly aggregated"],
        ["Ramp Safety Incidents", "0 preventable incidents", "Calendar year"],
        ["PRM Boarding Completion", "≥ 10 minutes before STD", "Per departure"]
    ]
    story.append(make_table(sla_data, [150, 180, 174], is_ruled=True))
    story.append(Spacer(1, 4))

    # Table 13: Surcharge & Penalty
    story.append(Paragraph("4.2 Service Credits and Financial Penalties", styles['sub_heading']))
    penalty_data = [
        ["Breach", "Service Credit"],
        ["First Bag delivery exceeding 25 minutes", "150.00 EUR per occurrence"],
        ["Ground Handling Delay attributable to Handler (>15 min)", "350.00 EUR per flight"],
        ["Failure to provide GPU within 5 min of on-chocks", "50.00 EUR per incident"],
        ["Baggage mishandling exceeding 3.5 per 1,000 pax", "500.00 EUR monthly credit"]
    ]
    story.append(make_table(penalty_data, [290, 214], is_ruled=True))
    story.append(Spacer(1, 6))

    # --- Page 6 ---
    story.append(PageBreak())
    story.append(Paragraph("PARAGRAPH 5 — CONFIDENTIALITY", styles['sec_heading']))
    story.append(Paragraph("5.1 Both parties agree to maintain strict confidentiality regarding all pricing schedules and commercial terms.", styles['body']))

    story.append(Paragraph("PARAGRAPH 6 — DATA PROTECTION", styles['sec_heading']))
    story.append(Paragraph("6.1 Processing of passenger data shall fully comply with EU Regulation 2016/679 (GDPR) and local aviation security laws.", styles['body']))

    story.append(Paragraph("PARAGRAPH 7 — DURATION, MODIFICATION AND TERMINATION", styles['sec_heading']))
    story.append(Paragraph(
        "7.1 This Annex B 1.0 shall remain in full force from 01 April 2022 until 31 March 2025 unless terminated earlier.",
        styles['body']
    ))

    story.append(Paragraph("PARAGRAPH 8 — GOVERNING LAW", styles['sec_heading']))
    story.append(Paragraph("8.1 This Agreement shall be governed by and construed in accordance with the laws of Greece.", styles['body']))

    # Table 14: Payment Schedule
    story.append(Paragraph("PARAGRAPH 10 — SETTLEMENT OF ACCOUNT", styles['sec_heading']))
    payment_data = [
        ["Invoice Event", "Due Within", "Method"],
        ["Monthly Basic Handling Services", "30 calendar days from invoice date", "Electronic Bank Transfer (SEPA / SWIFT)"],
        ["Ad-hoc and Supplemental Services", "15 calendar days from billing", "Electronic Bank Transfer"],
        ["Disbursements & Third-Party Outlays", "Immediate upon presentation", "Direct Debit or Wire Transfer"],
        ["Disputed Invoice Amounts", "Undisputed portion within 30 days", "Written notice within 10 days"]
    ]
    story.append(make_table(payment_data, [190, 160, 154], is_ruled=True))
    story.append(Spacer(1, 4))

    # Table 15: Deadline / Milestone
    story.append(Paragraph("10.2 Contractual Milestones and Audit Timetable", styles['sub_heading']))
    milestone_data = [
        ["Milestone", "Date"],
        ["Execution of Base Agreement", "15 March 2022"],
        ["Commencement of Operations", "01 April 2022"],
        ["First Annual Service Review", "15 January 2023"],
        ["First Annual Rate Indexation Notice", "01 March 2023"],
        ["Mid-Term Contract Audit", "01 October 2023"],
        ["Agreement Expiration / Renewal Notice", "31 December 2024"]
    ]
    story.append(make_table(milestone_data, [280, 224], is_ruled=True))
    story.append(Spacer(1, 4))

    # Table 16: Liability Limit
    story.append(Paragraph("PARAGRAPH 11 — LIMIT OF LIABILITY", styles['sec_heading']))
    liability_data = [
        ["Aircraft Type", "Limit (per incident)"],
        ["Narrow-Body (e.g. A320, B737 family)", "1,500,000 EUR"],
        ["Wide-Body (e.g. A330, A350, B777 family)", "3,000,000 EUR"],
        ["Regional Jet / Turboprop (e.g. ATR72, E190)", "750,000 EUR"]
    ]
    story.append(make_table(liability_data, [270, 234], is_ruled=True))
    story.append(Spacer(1, 6))

    # Table 17: Contact & Signature (S4: Wrapped header)
    story.append(Paragraph("PARAGRAPH 9 — NOTIFICATION & AUTHORIZED SIGNATURES", styles['sec_heading']))
    s4_data = [
        ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
        ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
        ["Title: VP Ground Operations & Inflight", "Title: Managing Director & Chief Commercial Officer"],
        ["Address: 142 Syngrou Avenue, 17671 Kallithea, Athens, Greece", "Address: Building 47, Cargo Terminal, Athens International Airport, 19019 Spata, Greece"],
        ["Email: groundops@aeroventure-synthetic.aero", "Email: contracts@nexus-groundhandling.synthetic"],
        ["Date: 15 March 2022", "Date: 15 March 2022"]
    ]
    story.append(make_table(s4_data, [252, 252], is_ruled=True))

    def make_canvas(*args, **kwargs):
        c = SyntheticDocCanvas(*args, **kwargs)
        c.doc_title = "ANNEX B 1.0 — AEROVENTURE AIRLINES / NEXUS GROUND HANDLING"
        c.running_header = "ANNEX B 1.0 — ATHENS (ATH/LGAV) BASE AGREEMENT"
        return c

    doc.build(story, canvasmaker=make_canvas)
    print(f"Built Document A: {output_path}")


def build_pdf_B(output_path):
    """
    Builds Document B (Annual Rate Revision Notice 2023-2024).
    Pure 3.00% CPI uplift across all tables. All 12 passenger rows carried forward.
    """
    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []

    story.append(Paragraph("ANNUAL RATE REVISION NOTICE — 2023", styles['doc_title']))
    story.append(Paragraph("ANNEX B 1.0 — SCHEDULED CHARGES ADJUSTMENT", styles['doc_subtitle']))
    
    # EXACT PROSE RELATION QUOTE
    story.append(Paragraph(
        "<b>This Annual Rate Revision Notice amends Annex B 1.0 dated 01 April 2022 in accordance with sub-clause 2.7 thereof.</b>",
        styles['body']
    ))
    story.append(Paragraph(
        "With effect from <b>01 April 2023</b> through <b>31 March 2024</b>, all Paragraph 1 handling charges shall be "
        "adjusted by three per cent (3.00%) as set forth below.",
        styles['body']
    ))
    story.append(Spacer(1, 3))

    # Metadata
    metadata_data = [
        ["Notice Reference", "ARRN-2023-ATH-001"],
        ["Carrier", "AEROVENTURE AIRLINES S.A."],
        ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
        ["Effective Window", "01 April 2023 to 31 March 2024"],
        ["Indexation Factor", "+3.00% (Annual Compound Indexation)"]
    ]
    story.append(make_table(metadata_data, [150, 354], is_ruled=False))
    story.append(Spacer(1, 4))

    # Tiered Handling Charges (Uplifted)
    story.append(Paragraph("REVISED PARAGRAPH 1.2 — BASIC TURNAROUND CHARGES", styles['sub_heading']))
    story.append(make_table(TIERED_CHARGES_B, [120, 110, 274], is_ruled=True))
    story.append(Spacer(1, 4))

    # RAMP SERVICES (M1: Clean uplift, 8 rows)
    story.append(Paragraph("REVISED PARAGRAPH 1 — RAMP SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(RAMP_ROWS_B, RAMP_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # --- Page 2 ---
    story.append(PageBreak())
    # SUPPORT SERVICES (Clean uplift, 6 rows)
    story.append(Paragraph("REVISED PARAGRAPH 1 — SUPPORT SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(SUPPORT_ROWS_B, SUPPORT_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # PASSENGER SERVICES (Clean uplift, full 12 rows carried forward)
    story.append(Paragraph("REVISED PARAGRAPH 1 — PASSENGER SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(PASSENGER_ROWS_B, PASSENGER_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # Notification & Signatures
    story.append(Paragraph("EXECUTION AND CONFIRMATION", styles['sec_heading']))
    sig_data = [
        ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
        ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
        ["Title: VP Ground Operations", "Title: Managing Director"],
        ["Date: 15 March 2023", "Date: 15 March 2023"]
    ]
    story.append(make_table(sig_data, [252, 252], is_ruled=True))

    def make_canvas(*args, **kwargs):
        c = SyntheticDocCanvas(*args, **kwargs)
        c.doc_title = "ANNUAL RATE REVISION NOTICE 2023 — AEROVENTURE / NEXUS"
        c.running_header = "RATE REVISION NOTICE 2023 — ATHENS (ATH/LGAV)"
        return c

    doc.build(story, canvasmaker=make_canvas)
    print(f"Built Document B: {output_path}")


def build_pdf_C(output_path):
    """
    Builds Document C (Annual Rate Revision Notice 2024-2025).
    Compounded 3.00% uplift on B.
    - Header rename (SGHA 2018 -> SGHA Ref) is scoped ONLY to C's ramp_services!
    - support_services and passenger_services headers in C remain 'SGHA 2018' so M5 stays clean.
    - All 12 passenger rows carried forward.
    - Ramp has 9 rows (M4 +1 row).
    - Support has 5 rows (M5 -1 row).
    """
    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []

    story.append(Paragraph("ANNUAL RATE REVISION NOTICE — 2024", styles['doc_title']))
    story.append(Paragraph("ANNEX B 1.0 — SCHEDULED CHARGES ADJUSTMENT & SERVICE UPDATES", styles['doc_subtitle']))
    
    # EXACT PROSE RELATION QUOTE
    story.append(Paragraph(
        "<b>This Annual Rate Revision Notice amends Annual Rate Revision Notice dated 01 April 2023 in accordance with sub-clause 2.7 of Annex B 1.0.</b>",
        styles['body']
    ))
    story.append(Paragraph(
        "With effect from <b>01 April 2024</b> through <b>31 March 2025</b>, all Paragraph 1 handling charges shall be "
        "compounded by an additional 3.00% over 2023 rates. In addition, the Ramp Services schedule is updated with "
        "new electric towing equipment, and off-airport crew transport is discontinued.",
        styles['body']
    ))
    story.append(Spacer(1, 3))

    # Metadata
    metadata_data = [
        ["Notice Reference", "ARRN-2024-ATH-002"],
        ["Carrier", "AEROVENTURE AIRLINES S.A."],
        ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
        ["Effective Window", "01 April 2024 to 31 March 2025"],
        ["Indexation Rule", "+3.00% Compounded on 2023 Tariff Rates"]
    ]
    story.append(make_table(metadata_data, [150, 354], is_ruled=False))
    story.append(Spacer(1, 4))

    # Tiered Handling Charges (Compounded Uplift)
    story.append(Paragraph("REVISED PARAGRAPH 1.2 — BASIC TURNAROUND CHARGES", styles['sub_heading']))
    story.append(make_table(TIERED_CHARGES_C, [120, 110, 274], is_ruled=True))
    story.append(Spacer(1, 4))

    # RAMP SERVICES (M2: Compounded uplift, M4: Row added [9 rows], M6: Column renamed SGHA Ref ONLY here!)
    story.append(Paragraph("REVISED PARAGRAPH 1 — RAMP SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(RAMP_ROWS_C, RAMP_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # --- Page 2 ---
    story.append(PageBreak())
    # SUPPORT SERVICES (M5: Row removed [5 rows], Header unchanged 'SGHA 2018'!)
    story.append(Paragraph("REVISED PARAGRAPH 1 — SUPPORT SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(SUPPORT_ROWS_C, SUPPORT_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # PASSENGER SERVICES (Compounded uplift, full 12 rows carried forward, Header 'SGHA 2018'!)
    story.append(Paragraph("REVISED PARAGRAPH 1 — PASSENGER SERVICES RATE CARD", styles['sub_heading']))
    story.append(make_table(PASSENGER_ROWS_C, PASSENGER_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # Notification & Signatures
    story.append(Paragraph("EXECUTION AND CONFIRMATION", styles['sec_heading']))
    sig_data = [
        ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
        ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
        ["Title: VP Ground Operations", "Title: Managing Director"],
        ["Date: 15 March 2024", "Date: 15 March 2024"]
    ]
    story.append(make_table(sig_data, [252, 252], is_ruled=True))

    def make_canvas(*args, **kwargs):
        c = SyntheticDocCanvas(*args, **kwargs)
        c.doc_title = "ANNUAL RATE REVISION NOTICE 2024 — AEROVENTURE / NEXUS"
        c.running_header = "RATE REVISION NOTICE 2024 — ATHENS (ATH/LGAV)"
        return c

    doc.build(story, canvasmaker=make_canvas)
    print(f"Built Document C: {output_path}")


def build_pdf_D(output_path):
    """
    Builds Document D (Amendment No. 1, Oct 2024 - Mar 2025).
    - PASSENGER SERVICES is a COMPLETE 12-ROW BYTE-IDENTICAL COPY OF A!
    - M7: New schedule De-Icing.
    """
    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []

    story.append(Paragraph("AMENDMENT NO. 1 TO ANNEX B 1.0", styles['doc_title']))
    story.append(Paragraph("REVISED LIABILITY LIMITS & NEW DE-ICING SCHEDULE", styles['doc_subtitle']))
    
    # EXACT PROSE RELATION QUOTE
    story.append(Paragraph(
        "<b>This Amendment No. 1 amends Annex B 1.0 dated 01 April 2022 with respect to liability limits and de-icing handling.</b>",
        styles['body']
    ))
    story.append(Paragraph(
        "With effect from <b>01 October 2024</b> through <b>31 March 2025</b>, the parties agree to amend the liability limits "
        "in Paragraph 11, establish a new dedicated De-Icing & Anti-Icing rate schedule under Paragraph 1, and reconfirm "
        "the existing Passenger Services schedule in its entirety without modification.",
        styles['body']
    ))
    story.append(Spacer(1, 3))

    # Metadata
    metadata_data = [
        ["Amendment Ref", "AMD-2024-ATH-001"],
        ["Carrier", "AEROVENTURE AIRLINES S.A."],
        ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
        ["Effective Date", "01 October 2024 to 31 March 2025"],
        ["Scope of Amendment", "Paragraph 11 Liability Limits & Introduction of De-Icing Schedule"]
    ]
    story.append(make_table(metadata_data, [150, 354], is_ruled=False))
    story.append(Spacer(1, 4))

    # Table: Revised Liability Limit
    story.append(Paragraph("AMENDED PARAGRAPH 11 — LIMIT OF LIABILITY", styles['sec_heading']))
    liability_data_d = [
        ["Aircraft Type", "Limit (per incident)"],
        ["Narrow-Body (e.g. A320, B737 family)", "2,000,000 EUR"],
        ["Wide-Body (e.g. A330, A350, B777 family)", "4,500,000 EUR"],
        ["Regional Jet / Turboprop (e.g. ATR72, E190)", "1,000,000 EUR"]
    ]
    story.append(make_table(liability_data_d, [270, 234], is_ruled=True))
    story.append(Spacer(1, 4))

    # Table: New De-Icing Schedule (M7: New Schedule with no predecessor)
    story.append(Paragraph("NEW PARAGRAPH 1.6 — DE-ICING & ANTI-ICING SERVICES", styles['sec_heading']))
    deicing_data = [
        ["DE-ICING & ANTI-ICING SERVICES", "", "", ""],
        ["Aircraft MTOW Band", "Application Charge (per aircraft)", "Type I Fluid (per Liter)", "Type IV Fluid (per Liter)"],
        ["≤ 20,000 kg", "220.00 EUR", "3.80 EUR", "4.50 EUR"],
        ["20,001 – 60,000 kg", "380.00 EUR", "3.80 EUR", "4.50 EUR"],
        ["60,001 – 140,000 kg", "590.00 EUR", "3.80 EUR", "4.50 EUR"],
        ["> 140,000 kg", "850.00 EUR", "3.80 EUR", "4.50 EUR"]
    ]
    story.append(make_table(deicing_data, [130, 164, 105, 105], is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # --- Page 2 ---
    story.append(PageBreak())
    # PASSENGER SERVICES (M3: COMPLETE 12-ROW BYTE-IDENTICAL COPY OF A)
    story.append(Paragraph("RECONFIRMED PARAGRAPH 1 — PASSENGER SERVICES (UNMODIFIED)", styles['sec_heading']))
    story.append(Paragraph("The Passenger Services rate schedule from Annex B 1.0 remains in effect without change:", styles['body']))
    story.append(make_table(PASSENGER_ROWS_D, PASSENGER_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # Notification & Signatures
    story.append(Paragraph("EXECUTION OF AMENDMENT NO. 1", styles['sec_heading']))
    sig_data = [
        ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
        ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
        ["Title: VP Ground Operations", "Title: Managing Director"],
        ["Date: 15 September 2024", "Date: 15 September 2024"]
    ]
    story.append(make_table(sig_data, [252, 252], is_ruled=True))

    def make_canvas(*args, **kwargs):
        c = SyntheticDocCanvas(*args, **kwargs)
        c.doc_title = "AMENDMENT NO. 1 — AEROVENTURE AIRLINES / NEXUS GROUND HANDLING"
        c.running_header = "AMENDMENT NO. 1 — ATHENS (ATH/LGAV)"
        return c

    doc.build(story, canvasmaker=make_canvas)
    print(f"Built Document D: {output_path}")


def build_pdf_E(output_path):
    """
    Builds Document E (Annex B 2.0 replacement 2025-2028).
    Tests M8 (structural change: RAMP SERVICES split into Arrival & Departure, SLA & Penalty merged).
    """
    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    story = []

    story.append(Paragraph("STANDARD GROUND HANDLING AGREEMENT — SIMPLIFIED PROCEDURE", styles['doc_title']))
    story.append(Paragraph("ANNEX B 2.0 — LOCATION, AGREED SERVICES AND CHARGES", styles['doc_subtitle']))
    
    # EXACT PROSE RELATION QUOTE
    story.append(Paragraph(
        "<b>This Agreement constitutes Annex B 2.0 and supersedes Annex B 1.0 dated 01 April 2022 in its entirety.</b>",
        styles['body']
    ))
    story.append(Paragraph(
        "Entered into as of <b>01 April 2025</b> between <b>AEROVENTURE AIRLINES S.A.</b> (\"Carrier\") "
        "and <b>NEXUS GROUND HANDLING SERVICES LTD.</b> (\"Handling Company\"), governing all handling operations "
        "at <b>Athens International Airport (ATH / LGAV)</b> through <b>31 March 2028</b>.",
        styles['body']
    ))
    story.append(Spacer(1, 3))

    # Metadata
    metadata_data = [
        ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
        ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
        ["Agreement Edition", "Annex B 2.0 (Triennial Replacement)"],
        ["Location / Station", "Athens International Airport (ATH / LGAV)"],
        ["Effective Term", "01 April 2025 to 31 March 2028"],
        ["Superseded Agreement", "Annex B 1.0 dated 01 April 2022 and all amendments thereto"]
    ]
    story.append(make_table(metadata_data, [160, 344], is_ruled=False))
    story.append(Spacer(1, 4))

    # PARAGRAPH 1 — Handling Services and Charges (Restructured M8)
    story.append(Paragraph("PARAGRAPH 1 — RESTRUCTURED RAMP HANDLING CHARGES", styles['sec_heading']))
    story.append(Paragraph(
        "Under this Annex B 2.0, ramp handling services are segregated into dedicated Arrival and Departure components.",
        styles['body']
    ))

    # M8 Split Table 1: RAMP SERVICES — ARRIVAL
    ramp_arr_rows = [
        ["RAMP SERVICES — ARRIVAL", "", "", ""],
        ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
        ["MARSHALLING", "PER FLIGHT", "FREE", "3.2.1(a)"],
        ["HEADSET COMMUNICATION", "PER FLIGHT", "FREE", "3.9.3(a)"],
        ["CABIN CLEANING — TRANSIT", "PER TURNAROUND", "195.00 EUR", "3.13.1"],
        ["POTABLE WATER SERVICE", "PER SERVICE", "60.00 EUR", "3.11.1"],
        ["TOILET SERVICING", "PER SERVICE", "70.00 EUR", "3.11.2"]
    ]
    story.append(make_table(ramp_arr_rows, RAMP_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # M8 Split Table 2: RAMP SERVICES — DEPARTURE
    ramp_dep_rows = [
        ["RAMP SERVICES — DEPARTURE", "", "", ""],
        ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
        ["GPU (GROUND POWER UNIT)", "PER HOUR", "48.00 EUR", "3.6.1(a)"],
        ["ASU (AIR START UNIT)", "PER ATTEMPT", "130.00 EUR", "3.6.1(b)"],
        ["PUSHBACK TRACTOR & CREW", "PER OPERATION", "120.00 EUR", "3.9.2(a)"]
    ]
    story.append(make_table(ramp_dep_rows, RAMP_COLS, is_banner=True, is_ruled=True))
    story.append(Spacer(1, 4))

    # --- Page 2 ---
    story.append(PageBreak())
    # PARAGRAPH 4 — STANDARD OF WORK (M8 Merged Table: SLA & Penalty)
    story.append(Paragraph("PARAGRAPH 4 — INTEGRATED SLA & SERVICE CREDITS SCHEDULE", styles['sec_heading']))
    story.append(Paragraph(
        "Performance targets and service credits are unified into a single integrated performance matrix:",
        styles['body']
    ))

    merged_sla_data = [
        ["SLA PERFORMANCE TARGETS & SERVICE CREDITS", "", "", ""],
        ["Performance Metric", "Service Target", "Measurement Window", "Service Credit / Penalty"],
        ["First Bag on Carousel", "≤ 15 minutes after on-chocks", "Per flight turnaround", "150.00 EUR per occurrence"],
        ["Last Bag on Carousel", "≤ 35 minutes after on-chocks", "Per flight turnaround", "100.00 EUR per occurrence"],
        ["On-Time Ground Despatch", "≥ 99.2% departures", "Monthly aggregated", "350.00 EUR per delayed flight"],
        ["Ramp Safety Incidents", "0 preventable incidents", "Calendar year", "1000.00 EUR per safety breach"],
        ["Baggage Mishandling Rate", "≤ 3.5 per 1,000 passengers", "Monthly aggregated", "500.00 EUR monthly credit"]
    ]
    story.append(make_table(merged_sla_data, [130, 130, 114, 130], is_banner=True, is_ruled=True))
    story.append(Spacer(1, 6))

    # Liability Table
    story.append(Paragraph("PARAGRAPH 11 — LIMIT OF LIABILITY", styles['sec_heading']))
    liability_data_e = [
        ["Aircraft Type", "Limit (per incident)"],
        ["Narrow-Body (e.g. A320, B737 family)", "2,000,000 EUR"],
        ["Wide-Body (e.g. A330, A350, B777 family)", "5,000,000 EUR"],
        ["Regional Jet / Turboprop (e.g. ATR72, E190)", "1,200,000 EUR"]
    ]
    story.append(make_table(liability_data_e, [270, 234], is_ruled=True))
    story.append(Spacer(1, 6))

    # Notification & Signatures
    story.append(Paragraph("PARAGRAPH 9 — NOTIFICATION & AUTHORIZED SIGNATURES", styles['sec_heading']))
    sig_data_e = [
        ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
        ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
        ["Title: VP Ground Operations & Safety", "Title: Chief Executive Officer"],
        ["Address: 142 Syngrou Avenue, 17671 Kallithea, Athens, Greece", "Address: Building 47, Cargo Terminal, Athens Airport, 19019 Spata, Greece"],
        ["Date: 15 March 2025", "Date: 15 March 2025"]
    ]
    story.append(make_table(sig_data_e, [252, 252], is_ruled=True))

    def make_canvas(*args, **kwargs):
        c = SyntheticDocCanvas(*args, **kwargs)
        c.doc_title = "ANNEX B 2.0 — AEROVENTURE AIRLINES / NEXUS GROUND HANDLING"
        c.running_header = "ANNEX B 2.0 — ATHENS (ATH/LGAV) REPLACEMENT AGREEMENT"
        return c

    doc.build(story, canvasmaker=make_canvas)
    print(f"Built Document E: {output_path}")


# ==========================================
# GROUND TRUTH & README BUILDERS
# ==========================================

def build_ground_truth(output_path):
    """
    Constructs the exact machine-assertable ground_truth.json (v2).
    """
    # Extract data rows without banner (row 0) and header (row 1)
    ramp_a_rows = RAMP_ROWS_A[2:]
    ramp_b_rows = RAMP_ROWS_B[2:]
    ramp_c_rows = RAMP_ROWS_C[2:]

    support_a_rows = SUPPORT_ROWS_A[2:]
    support_b_rows = SUPPORT_ROWS_B[2:]
    support_c_rows = SUPPORT_ROWS_C[2:]

    pass_a_rows = PASSENGER_ROWS_A[2:]
    pass_b_rows = PASSENGER_ROWS_B[2:]
    pass_c_rows = PASSENGER_ROWS_C[2:]
    pass_d_rows = PASSENGER_ROWS_D[2:]

    ground_truth = {
        "corpus_version": "2",
        "cpi_rate": 0.03,
        "documents": [
            {
                "document_id": "A",
                "file": "A_AnnexB_1.0_2022.pdf",
                "effective_from": "2022-04-01",
                "effective_to": "2025-03-31",
                "relation": None,
                "relation_quote": None,
                "tables": [
                    {
                        "table_key": "contract_metadata",
                        "caption": "CONTRACT METADATA & PARTICULARS",
                        "category": "Contract Metadata",
                        "page": 1,
                        "is_ruled": False,
                        "header": ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
                        "rows": [
                            ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
                            ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
                            ["Governing Standard", "IATA Standard Ground Handling Agreement (AHM 810) — 2018 Simplified Procedure"],
                            ["Location / Station", "Athens International Airport (ATH / LGAV), Spata, Attica, Greece"],
                            ["Effective Period", "01 April 2022 to 31 March 2025"],
                            ["Prior Agreement", "None — Initial Base Agreement (Annex B 1.0)"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "scope_and_services",
                        "caption": "ANNEX A SCOPE & SERVICES MATRIX",
                        "category": "Scope & Services Matrix",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["Annex A Section", "Service Description", "Status", "Special Handling Notes"],
                        "rows": [
                            ["Section 1.1.2", "Station Management & Local Representation", "Included", "Designated representative provided"],
                            ["Section 2.1.1", "Passenger Check-in System Interface", "Included", ""],
                            ["Section 3.3.1", "Baggage Sorting and Loading", "Included", "Bulk and containerized ULD"],
                            ["Section 3.6.1", "Ground Power Unit Provision (400 Hz)", "Optional / Per Use", "Subject to tariff"],
                            ["Section 4.1.2", "Air Cargo Document Handling", "Excluded", ""],
                            ["Section 6.3.1", "Crew Surface Transportation (Airside)", "Included", "Apron shuttle only"]
                        ],
                        "stress_cases": ["S8"]
                    },
                    {
                        "table_key": "tiered_pricing",
                        "caption": "1.2 Basic Turnaround Handling Charges (Tiered by MTOW)",
                        "category": "Tiered Pricing",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
                        "rows": TIERED_CHARGES_A[1:],
                        "stress_cases": []
                    },
                    {
                        "table_key": "turnaround_packages",
                        "caption": "1.3 Standard Turnaround Package Rates",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["Aircraft Category", "Turnaround Specification", "Fixed Rate", "SGHA Ref"],
                        "rows": [
                            ["Narrow-Body Aircraft", "A319 / A320 / A321 Standard Turnaround", "620.00 EUR", "3.1.1"],
                            ["Narrow-Body Aircraft", "B737-700 / 800 / 900 Turnaround", "640.00 EUR", "3.1.2"],
                            ["", "", "", ""],
                            ["Wide-Body Aircraft", "A330-200 / 300 Wide-Body Turnaround", "1250.00 EUR", "3.1.3"],
                            ["Wide-Body Aircraft", "B777-200 / 300 Wide-Body Turnaround", "1420.00 EUR", "3.1.4"]
                        ],
                        "stress_cases": ["S10"]
                    },
                    {
                        "table_key": "ramp_services",
                        "caption": "RAMP SERVICES",
                        "category": "Rate Schedule",
                        "page": 3,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": ramp_a_rows,
                        "stress_cases": ["S2", "S3"]
                    },
                    {
                        "table_key": "support_services",
                        "caption": "SUPPORT SERVICES",
                        "category": "Rate Schedule",
                        "page": 3,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": support_a_rows,
                        "stress_cases": ["S2", "S3"]
                    },
                    {
                        "table_key": "passenger_services",
                        "caption": "PASSENGER SERVICES",
                        "category": "Rate Schedule",
                        "page": 4,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": pass_a_rows,
                        "stress_cases": ["S3", "S5"]
                    },
                    {
                        "table_key": "staffing_resourcing",
                        "caption": "1.4 Dedicated Station Staffing Allocation",
                        "category": "Staffing & Resourcing",
                        "page": 4,
                        "is_ruled": True,
                        "header": ["Position", "Number of Staff", "Man hours"],
                        "rows": [
                            ["Station Duty Manager", "1", "8.0"],
                            ["Ramp Team Leader / Supervisor", "1", "4.5"],
                            ["Baggage Loading Agents", "4", "18.0"],
                            ["Passenger Service Agents", "3", "12.0"],
                            ["Load Control Officer", "centralized", "on request"],
                            ["Safety & Compliance Auditor", "1", "centralized"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "labor_overtime_rates",
                        "caption": "1.5 Supplemental Labor Hourly Overtime Rates",
                        "category": "Staffing & Resourcing",
                        "page": 4,
                        "is_ruled": True,
                        "header": ["", "Straight Time", "Overtime (1.5x)", "Holiday (2.0x)"],
                        "rows": [
                            ["Duty Manager", "45.00 EUR", "67.50 EUR", "90.00 EUR"],
                            ["Ramp Agent", "28.00 EUR", "42.00 EUR", "56.00 EUR"],
                            ["Passenger Service Agent", "26.00 EUR", "39.00 EUR", "52.00 EUR"],
                            ["Baggage Handler", "24.00 EUR", "36.00 EUR", "48.00 EUR"]
                        ],
                        "stress_cases": ["S7"]
                    },
                    {
                        "table_key": "disbursements_and_fees",
                        "caption": "3.2 Regulatory Authority and Third-Party Pass-Through Fees",
                        "category": "Rate Schedule",
                        "page": 5,
                        "is_ruled": True,
                        "header": ["Fee Description", "Currency", "Billing Rate / Basis", "Billing Entity & Notification Address"],
                        "rows": [
                            ["Airport Infrastructure Levy", "€", "14.50 per turnaround", "Athens International Airport S.A., 19019 Spata, Greece"],
                            ["International Overflight Fee", "$", "25.00 USD flat", "HCAA Navigation Service, 16604 Hellinikon, Greece"],
                            ["Disbursement Admin Fee", "%", "5.25% of outlay", "Nexus Ground Handling Services Ltd."],
                            ["De-Icing Reserve Allocation", "USD", "500.00 USD per season", "Nexus Hub Europe — Straßburger Straße 18, 10405 Berlin"],
                            ["Regional Civil Aviation Dues", "€", "18.00 EUR per flight", "Hellenic CAA — Λεωφόρος Βασιλέως Κωνσταντίνου 44, 11635 Αθήνα"]
                        ],
                        "stress_cases": ["S9"]
                    },
                    {
                        "table_key": "equipment_rates_unruled",
                        "caption": "PARAGRAPH 3.3 SUPPLEMENTAL GROUND EQUIPMENT RATES",
                        "category": "Rate Schedule",
                        "page": 5,
                        "is_ruled": False,
                        "header": ["Equipment Description", "Standard Hourly Rate"],
                        "rows": [
                            ["GPU Air Start Unit (ASU)", "140.00 EUR"],
                            ["Cabin Air Heater / Air Conditioner Unit", "95.00 EUR"],
                            ["Mobile Passenger Boarding Stairs (Towable)", "60.00 EUR"],
                            ["Main Deck Cargo Loader (High-Loader)", "210.00 EUR"],
                            ["Belt Loader (Self-Propelled)", "55.00 EUR"]
                        ],
                        "stress_cases": ["S6"]
                    },
                    {
                        "table_key": "sla_performance",
                        "caption": "4.1 Service Level Agreement (SLA) Performance Standards",
                        "category": "SLA / Performance Target",
                        "page": 5,
                        "is_ruled": True,
                        "header": ["Metric", "Target", "Measurement Window"],
                        "rows": [
                            ["First Bag on Carousel", "≤ 15 minutes after on-chocks", "Per flight turnaround"],
                            ["Last Bag on Carousel", "≤ 35 minutes after on-chocks", "Per flight turnaround"],
                            ["On-Time Ground Despatch", "≥ 99.2% departures", "Monthly aggregated"],
                            ["Ramp Safety Incidents", "0 preventable incidents", "Calendar year"],
                            ["PRM Boarding Completion", "≥ 10 minutes before STD", "Per departure"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "surcharge_penalty",
                        "caption": "4.2 Service Credits and Financial Penalties",
                        "category": "Surcharge & Penalty",
                        "page": 5,
                        "is_ruled": True,
                        "header": ["Breach", "Service Credit"],
                        "rows": [
                            ["First Bag delivery exceeding 25 minutes", "150.00 EUR per occurrence"],
                            ["Ground Handling Delay attributable to Handler (>15 min)", "350.00 EUR per flight"],
                            ["Failure to provide GPU within 5 min of on-chocks", "50.00 EUR per incident"],
                            ["Baggage mishandling exceeding 3.5 per 1,000 pax", "500.00 EUR monthly credit"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "payment_schedule",
                        "caption": "PARAGRAPH 10 — SETTLEMENT OF ACCOUNT",
                        "category": "Payment Schedule",
                        "page": 6,
                        "is_ruled": True,
                        "header": ["Invoice Event", "Due Within", "Method"],
                        "rows": [
                            ["Monthly Basic Handling Services", "30 calendar days from invoice date", "Electronic Bank Transfer (SEPA / SWIFT)"],
                            ["Ad-hoc and Supplemental Services", "15 calendar days from billing", "Electronic Bank Transfer"],
                            ["Disbursements & Third-Party Outlays", "Immediate upon presentation", "Direct Debit or Wire Transfer"],
                            ["Disputed Invoice Amounts", "Undisputed portion within 30 days", "Written notice within 10 days"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "contract_milestones",
                        "caption": "10.2 Contractual Milestones and Audit Timetable",
                        "category": "Deadline / Milestone",
                        "page": 6,
                        "is_ruled": True,
                        "header": ["Milestone", "Date"],
                        "rows": [
                            ["Execution of Base Agreement", "15 March 2022"],
                            ["Commencement of Operations", "01 April 2022"],
                            ["First Annual Service Review", "15 January 2023"],
                            ["First Annual Rate Indexation Notice", "01 March 2023"],
                            ["Mid-Term Contract Audit", "01 October 2023"],
                            ["Agreement Expiration / Renewal Notice", "31 December 2024"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "liability_limit",
                        "caption": "PARAGRAPH 11 — LIMIT OF LIABILITY",
                        "category": "Liability Limit",
                        "page": 6,
                        "is_ruled": True,
                        "header": ["Aircraft Type", "Limit (per incident)"],
                        "rows": [
                            ["Narrow-Body (e.g. A320, B737 family)", "1,500,000 EUR"],
                            ["Wide-Body (e.g. A330, A350, B777 family)", "3,000,000 EUR"],
                            ["Regional Jet / Turboprop (e.g. ATR72, E190)", "750,000 EUR"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "contact_and_signature",
                        "caption": "PARAGRAPH 9 — NOTIFICATION & AUTHORIZED SIGNATURES",
                        "category": "Contact & Signature",
                        "page": 6,
                        "is_ruled": True,
                        "header": ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
                        "rows": [
                            ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
                            ["Title: VP Ground Operations & Inflight", "Title: Managing Director & Chief Commercial Officer"],
                            ["Address: 142 Syngrou Avenue, 17671 Kallithea, Athens, Greece", "Address: Building 47, Cargo Terminal, Athens International Airport, 19019 Spata, Greece"],
                            ["Email: groundops@aeroventure-synthetic.aero", "Email: contracts@nexus-groundhandling.synthetic"],
                            ["Date: 15 March 2022", "Date: 15 March 2022"]
                        ],
                        "stress_cases": ["S4"]
                    }
                ],
                "non_tables": [
                    {
                        "description": "clauses 2.1-2.7 hanging indent prose paragraphs",
                        "page": 2,
                        "stress_cases": ["S1"]
                    }
                ]
            },
            {
                "document_id": "B",
                "file": "B_RateRevision_2023.pdf",
                "effective_from": "2023-04-01",
                "effective_to": "2024-03-31",
                "relation": "amends A",
                "relation_quote": "This Annual Rate Revision Notice amends Annex B 1.0 dated 01 April 2022 in accordance with sub-clause 2.7 thereof.",
                "tables": [
                    {
                        "table_key": "contract_metadata",
                        "caption": "METADATA",
                        "category": "Contract Metadata",
                        "page": 1,
                        "is_ruled": False,
                        "header": ["Notice Reference", "ARRN-2023-ATH-001"],
                        "rows": [
                            ["Notice Reference", "ARRN-2023-ATH-001"],
                            ["Carrier", "AEROVENTURE AIRLINES S.A."],
                            ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
                            ["Effective Window", "01 April 2023 to 31 March 2024"],
                            ["Indexation Factor", "+3.00% (Annual Compound Indexation)"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "tiered_pricing",
                        "caption": "REVISED PARAGRAPH 1.2 — BASIC TURNAROUND CHARGES",
                        "category": "Tiered Pricing",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
                        "rows": TIERED_CHARGES_B[1:],
                        "stress_cases": []
                    },
                    {
                        "table_key": "ramp_services",
                        "caption": "RAMP SERVICES",
                        "category": "Rate Schedule",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": ramp_b_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "support_services",
                        "caption": "SUPPORT SERVICES",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": support_b_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "passenger_services",
                        "caption": "PASSENGER SERVICES",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": pass_b_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "contact_and_signature",
                        "caption": "EXECUTION AND CONFIRMATION",
                        "category": "Contact & Signature",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
                        "rows": [
                            ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
                            ["Title: VP Ground Operations", "Title: Managing Director"],
                            ["Date: 15 March 2023", "Date: 15 March 2023"]
                        ],
                        "stress_cases": ["S4"]
                    }
                ],
                "non_tables": []
            },
            {
                "document_id": "C",
                "file": "C_RateRevision_2024.pdf",
                "effective_from": "2024-04-01",
                "effective_to": "2025-03-31",
                "relation": "amends B",
                "relation_quote": "This Annual Rate Revision Notice amends Annual Rate Revision Notice dated 01 April 2023 in accordance with sub-clause 2.7 of Annex B 1.0.",
                "tables": [
                    {
                        "table_key": "contract_metadata",
                        "caption": "METADATA",
                        "category": "Contract Metadata",
                        "page": 1,
                        "is_ruled": False,
                        "header": ["Notice Reference", "ARRN-2024-ATH-002"],
                        "rows": [
                            ["Notice Reference", "ARRN-2024-ATH-002"],
                            ["Carrier", "AEROVENTURE AIRLINES S.A."],
                            ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
                            ["Effective Window", "01 April 2024 to 31 March 2025"],
                            ["Indexation Rule", "+3.00% Compounded on 2023 Tariff Rates"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "tiered_pricing",
                        "caption": "REVISED PARAGRAPH 1.2 — BASIC TURNAROUND CHARGES",
                        "category": "Tiered Pricing",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["Aircraft Maximum Take-Off Weight (MTOW)", "Turnaround Basic Charge (EUR)", "Turnaround Service Scope"],
                        "rows": TIERED_CHARGES_C[1:],
                        "stress_cases": []
                    },
                    {
                        "table_key": "ramp_services",
                        "caption": "RAMP SERVICES",
                        "category": "Rate Schedule",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA Ref"],  # M6: SGHA Ref ONLY in C's ramp_services!
                        "rows": ramp_c_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "support_services",
                        "caption": "SUPPORT SERVICES",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],  # Header unchanged!
                        "rows": support_c_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "passenger_services",
                        "caption": "PASSENGER SERVICES",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],  # Header unchanged!
                        "rows": pass_c_rows,
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "contact_and_signature",
                        "caption": "EXECUTION AND CONFIRMATION",
                        "category": "Contact & Signature",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
                        "rows": [
                            ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
                            ["Title: VP Ground Operations", "Title: Managing Director"],
                            ["Date: 15 March 2024", "Date: 15 March 2024"]
                        ],
                        "stress_cases": ["S4"]
                    }
                ],
                "non_tables": []
            },
            {
                "document_id": "D",
                "file": "D_Amendment_1_2024.pdf",
                "effective_from": "2024-10-01",
                "effective_to": "2025-03-31",
                "relation": "amends A",
                "relation_quote": "This Amendment No. 1 amends Annex B 1.0 dated 01 April 2022 with respect to liability limits and de-icing handling.",
                "tables": [
                    {
                        "table_key": "contract_metadata",
                        "caption": "METADATA",
                        "category": "Contract Metadata",
                        "page": 1,
                        "is_ruled": False,
                        "header": ["Amendment Ref", "AMD-2024-ATH-001"],
                        "rows": [
                            ["Amendment Ref", "AMD-2024-ATH-001"],
                            ["Carrier", "AEROVENTURE AIRLINES S.A."],
                            ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
                            ["Effective Date", "01 October 2024 to 31 March 2025"],
                            ["Scope of Amendment", "Paragraph 11 Liability Limits & Introduction of De-Icing Schedule"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "liability_limit",
                        "caption": "AMENDED PARAGRAPH 11 — LIMIT OF LIABILITY",
                        "category": "Liability Limit",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["Aircraft Type", "Limit (per incident)"],
                        "rows": [
                            ["Narrow-Body (e.g. A320, B737 family)", "2,000,000 EUR"],
                            ["Wide-Body (e.g. A330, A350, B777 family)", "4,500,000 EUR"],
                            ["Regional Jet / Turboprop (e.g. ATR72, E190)", "1,000,000 EUR"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "deicing_services",
                        "caption": "DE-ICING & ANTI-ICING SERVICES",
                        "category": "Tiered Pricing",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["Aircraft MTOW Band", "Application Charge (per aircraft)", "Type I Fluid (per Liter)", "Type IV Fluid (per Liter)"],
                        "rows": [
                            ["≤ 20,000 kg", "220.00 EUR", "3.80 EUR", "4.50 EUR"],
                            ["20,001 – 60,000 kg", "380.00 EUR", "3.80 EUR", "4.50 EUR"],
                            ["60,001 – 140,000 kg", "590.00 EUR", "3.80 EUR", "4.50 EUR"],
                            ["> 140,000 kg", "850.00 EUR", "3.80 EUR", "4.50 EUR"]
                        ],
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "passenger_services",
                        "caption": "PASSENGER SERVICES",
                        "category": "Rate Schedule",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": pass_d_rows,  # Complete 12 rows copy of A
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "contact_and_signature",
                        "caption": "EXECUTION OF AMENDMENT NO. 1",
                        "category": "Contact & Signature",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
                        "rows": [
                            ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
                            ["Title: VP Ground Operations", "Title: Managing Director"],
                            ["Date: 15 September 2024", "Date: 15 September 2024"]
                        ],
                        "stress_cases": ["S4"]
                    }
                ],
                "non_tables": []
            },
            {
                "document_id": "E",
                "file": "E_AnnexB_2.0_2025.pdf",
                "effective_from": "2025-04-01",
                "effective_to": "2028-03-31",
                "relation": "supersedes A",
                "relation_quote": "This Agreement constitutes Annex B 2.0 and supersedes Annex B 1.0 dated 01 April 2022 in its entirety.",
                "tables": [
                    {
                        "table_key": "contract_metadata",
                        "caption": "METADATA",
                        "category": "Contract Metadata",
                        "page": 1,
                        "is_ruled": False,
                        "header": ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
                        "rows": [
                            ["Carrier Name", "AEROVENTURE AIRLINES S.A."],
                            ["Handling Company", "NEXUS GROUND HANDLING SERVICES LTD."],
                            ["Agreement Edition", "Annex B 2.0 (Triennial Replacement)"],
                            ["Location / Station", "Athens International Airport (ATH / LGAV)"],
                            ["Effective Term", "01 April 2025 to 31 March 2028"],
                            ["Superseded Agreement", "Annex B 1.0 dated 01 April 2022 and all amendments thereto"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "ramp_arrival",
                        "caption": "RAMP SERVICES — ARRIVAL",
                        "category": "Rate Schedule",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": [
                            ["MARSHALLING", "PER FLIGHT", "FREE", "3.2.1(a)"],
                            ["HEADSET COMMUNICATION", "PER FLIGHT", "FREE", "3.9.3(a)"],
                            ["CABIN CLEANING — TRANSIT", "PER TURNAROUND", "195.00 EUR", "3.13.1"],
                            ["POTABLE WATER SERVICE", "PER SERVICE", "60.00 EUR", "3.11.1"],
                            ["TOILET SERVICING", "PER SERVICE", "70.00 EUR", "3.11.2"]
                        ],
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "ramp_departure",
                        "caption": "RAMP SERVICES — DEPARTURE",
                        "category": "Rate Schedule",
                        "page": 1,
                        "is_ruled": True,
                        "header": ["DESCRIPTION", "UNIT", "PRICE", "SGHA 2018"],
                        "rows": [
                            ["GPU (GROUND POWER UNIT)", "PER HOUR", "48.00 EUR", "3.6.1(a)"],
                            ["ASU (AIR START UNIT)", "PER ATTEMPT", "130.00 EUR", "3.6.1(b)"],
                            ["PUSHBACK TRACTOR & CREW", "PER OPERATION", "120.00 EUR", "3.9.2(a)"]
                        ],
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "sla_and_service_credits",
                        "caption": "SLA PERFORMANCE TARGETS & SERVICE CREDITS",
                        "category": "SLA / Performance Target",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["Performance Metric", "Service Target", "Measurement Window", "Service Credit / Penalty"],
                        "rows": [
                            ["First Bag on Carousel", "≤ 15 minutes after on-chocks", "Per flight turnaround", "150.00 EUR per occurrence"],
                            ["Last Bag on Carousel", "≤ 35 minutes after on-chocks", "Per flight turnaround", "100.00 EUR per occurrence"],
                            ["On-Time Ground Despatch", "≥ 99.2% departures", "Monthly aggregated", "350.00 EUR per delayed flight"],
                            ["Ramp Safety Incidents", "0 preventable incidents", "Calendar year", "1000.00 EUR per safety breach"],
                            ["Baggage Mishandling Rate", "≤ 3.5 per 1,000 passengers", "Monthly aggregated", "500.00 EUR monthly credit"]
                        ],
                        "stress_cases": ["S3"]
                    },
                    {
                        "table_key": "liability_limit",
                        "caption": "PARAGRAPH 11 — LIMIT OF LIABILITY",
                        "category": "Liability Limit",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["Aircraft Type", "Limit (per incident)"],
                        "rows": [
                            ["Narrow-Body (e.g. A320, B737 family)", "2,000,000 EUR"],
                            ["Wide-Body (e.g. A330, A350, B777 family)", "5,000,000 EUR"],
                            ["Regional Jet / Turboprop (e.g. ATR72, E190)", "1,200,000 EUR"]
                        ],
                        "stress_cases": []
                    },
                    {
                        "table_key": "contact_and_signature",
                        "caption": "PARAGRAPH 9 — NOTIFICATION & AUTHORIZED SIGNATURES",
                        "category": "Contact & Signature",
                        "page": 2,
                        "is_ruled": True,
                        "header": ["For the Carrier:\nAEROVENTURE AIRLINES S.A.", "For the Handling Company:\nNEXUS GROUND HANDLING SERVICES LTD."],
                        "rows": [
                            ["Name: Capt. Nikos Vassiliou", "Name: Elena Papandreou"],
                            ["Title: VP Ground Operations & Safety", "Title: Chief Executive Officer"],
                            ["Address: 142 Syngrou Avenue, 17671 Kallithea, Athens, Greece", "Address: Building 47, Cargo Terminal, Athens Airport, 19019 Spata, Greece"],
                            ["Date: 15 March 2025", "Date: 15 March 2025"]
                        ],
                        "stress_cases": ["S4"]
                    }
                ],
                "non_tables": []
            }
        ],
        "expected_mappings": [
            {
                "case": "M1",
                "from": {"document_id": "A", "table_key": "ramp_services"},
                "to": {"document_id": "B", "table_key": "ramp_services"},
                "signature_should_match": True,
                "fuzzy_should_match": True,
                "row_diff": [
                    {"row_key": "MARSHALLING", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "GPU (GROUND POWER UNIT)", "change": "changed", "old": "45.00 EUR", "new": "46.35 EUR"},
                    {"row_key": "ASU (AIR START UNIT)", "change": "changed", "old": "120.00 EUR", "new": "123.60 EUR"},
                    {"row_key": "PUSHBACK TRACTOR & CREW", "change": "changed", "old": "110.00 EUR", "new": "113.30 EUR"},
                    {"row_key": "HEADSET COMMUNICATION", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "POTABLE WATER SERVICE", "change": "changed", "old": "55.00 EUR", "new": "56.65 EUR"},
                    {"row_key": "TOILET SERVICING", "change": "changed", "old": "65.00 EUR", "new": "66.95 EUR"},
                    {"row_key": "CABIN CLEANING — TRANSIT", "change": "changed", "old": "180.00 EUR", "new": "185.40 EUR"}
                ]
            },
            {
                "case": "M2",
                "from": {"document_id": "B", "table_key": "ramp_services"},
                "to": {"document_id": "C", "table_key": "ramp_services"},
                "signature_should_match": False,
                "fuzzy_should_match": True,
                "notes": "Signature does not exact-match because column header was renamed from 'SGHA 2018' to 'SGHA Ref' in C; fuzzy match succeeds.",
                "row_diff": [
                    {"row_key": "MARSHALLING", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "GPU (GROUND POWER UNIT)", "change": "changed", "old": "46.35 EUR", "new": "47.74 EUR"},
                    {"row_key": "ASU (AIR START UNIT)", "change": "changed", "old": "123.60 EUR", "new": "127.31 EUR"},
                    {"row_key": "PUSHBACK TRACTOR & CREW", "change": "changed", "old": "113.30 EUR", "new": "116.70 EUR"},
                    {"row_key": "HEADSET COMMUNICATION", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "POTABLE WATER SERVICE", "change": "changed", "old": "56.65 EUR", "new": "58.35 EUR"},
                    {"row_key": "TOILET SERVICING", "change": "changed", "old": "66.95 EUR", "new": "68.96 EUR"},
                    {"row_key": "CABIN CLEANING — TRANSIT", "change": "changed", "old": "185.40 EUR", "new": "190.96 EUR"},
                    {"row_key": "ELECTRIC TOWBARLESS TRACTOR", "change": "added", "old": None, "new": "140.00 EUR"}
                ]
            },
            {
                "case": "M3",
                "from": {"document_id": "A", "table_key": "passenger_services"},
                "to": {"document_id": "D", "table_key": "passenger_services"},
                "signature_should_match": True,
                "fuzzy_should_match": True,
                "row_diff": [
                    {"row_key": "CHECK-IN COUNTER STAFFING", "change": "unchanged", "old": "38.00 EUR", "new": "38.00 EUR"},
                    {"row_key": "BOARDING GATE MANAGEMENT", "change": "unchanged", "old": "85.00 EUR", "new": "85.00 EUR"},
                    {"row_key": "SPECIAL PASSENGER ASSISTANCE (PRM)", "change": "unchanged", "old": "22.00 EUR", "new": "22.00 EUR"},
                    {"row_key": "LOST & FOUND / BAGGAGE TRACING (WORLDTRACER)", "change": "unchanged", "old": "28.00 EUR", "new": "28.00 EUR"},
                    {"row_key": "TRANSIT PASSENGER ESCORT", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "VIP / LOUNGE HOSTING", "change": "unchanged", "old": "on request (R)", "new": "on request (R)"},
                    {"row_key": "EXCESS BAGGAGE COLLECTION", "change": "unchanged", "old": "18.00 EUR", "new": "18.00 EUR"},
                    {"row_key": "UNACCOMPANIED MINOR (UM) ESCORT", "change": "unchanged", "old": "35.00 EUR", "new": "35.00 EUR"},
                    {"row_key": "STANDBY PASSENGER PROCESSING", "change": "unchanged", "old": "12.00 EUR", "new": "12.00 EUR"},
                    {"row_key": "DOCUMENTATION & VISA VERIFICATION", "change": "unchanged", "old": "FREE", "new": "FREE"},
                    {"row_key": "BAGGAGE DELIVERY TO HOTEL", "change": "unchanged", "old": "45.00 EUR", "new": "45.00 EUR"},
                    {"row_key": "FLIGHT IRREGULARITY RE-BOOKING", "change": "unchanged", "old": "50.00 EUR", "new": "50.00 EUR"}
                ]
            },
            {
                "case": "M4",
                "from": {"document_id": "B", "table_key": "ramp_services"},
                "to": {"document_id": "C", "table_key": "ramp_services"},
                "signature_should_match": False,
                "fuzzy_should_match": True,
                "row_diff": [
                    {"row_key": "ELECTRIC TOWBARLESS TRACTOR", "change": "added", "old": None, "new": "140.00 EUR"}
                ]
            },
            {
                "case": "M5",
                "from": {"document_id": "B", "table_key": "support_services"},
                "to": {"document_id": "C", "table_key": "support_services"},
                "signature_should_match": True,
                "fuzzy_should_match": True,
                "notes": "support_services headers remain strictly 'SGHA 2018' in both B and C so M5 signature matches cleanly.",
                "row_diff": [
                    {"row_key": "UNIT LOAD DEVICE (ULD) CONTROL", "change": "changed", "old": "36.05 EUR", "new": "37.13 EUR"},
                    {"row_key": "CREW TRANSPORT — AIRSIDE", "change": "changed", "old": "41.20 EUR", "new": "42.44 EUR"},
                    {"row_key": "CREW TRANSPORT — OFF-AIRPORT", "change": "removed", "old": "77.25 EUR", "new": None},
                    {"row_key": "LOAD CONTROL / WEIGHT & BALANCE", "change": "changed", "old": "92.70 EUR", "new": "95.48 EUR"},
                    {"row_key": "COMMUNICATIONS (SITA / ARINC)", "change": "unchanged", "old": "at cost", "new": "at cost"},
                    {"row_key": "SECURITY WATCH (AIRSIDE)", "change": "changed", "old": "32.96 EUR", "new": "33.95 EUR"}
                ]
            },
            {
                "case": "M6",
                "from": {"document_id": "B", "table_key": "ramp_services"},
                "to": {"document_id": "C", "table_key": "ramp_services"},
                "signature_should_match": False,
                "fuzzy_should_match": True,
                "notes": "Column renamed from 'SGHA 2018' to 'SGHA Ref' in C's ramp_services only. Tests signature drift fallback."
            },
            {
                "case": "M7",
                "from": None,
                "to": {"document_id": "D", "table_key": "deicing_services"},
                "signature_should_match": False,
                "fuzzy_should_match": False,
                "notes": "New schedule introduced in Amendment No. 1 with no predecessor. Must not be force-matched."
            },
            {
                "case": "M8",
                "from": {"document_id": "A", "table_key": "ramp_services"},
                "to": [
                    {"document_id": "E", "table_key": "ramp_arrival"},
                    {"document_id": "E", "table_key": "ramp_departure"}
                ],
                "signature_should_match": False,
                "fuzzy_should_match": False,
                "notes": "Structural change: RAMP SERVICES split into ARRIVAL (1->2) and DEPARTURE; SLA and Penalty merged (2->1)."
            }
        ]
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2, ensure_ascii=False)
    print(f"Built ground_truth.json: {output_path}")


def build_readme(output_path):
    """
    Constructs the comprehensive README.md file (v2).
    """
    content = """# IATA AHM 810 Synthetic Test Corpus (v2)

## Overview
This directory contains a synthetic test corpus for a contract-ingestion pipeline under the **IATA AHM 810 — Standard Ground Handling Agreement (SGHA), Simplified Procedure, Annex B**.

The corpus models the multi-year lifecycle of ground-handling agreements for one carrier at one station, designed specifically for testing:
1. **PDF Table Extraction**: Bordered, unruled, multi-page, and irregular tables.
2. **Table Classification**: Classification across 12 standardized contract table categories.
3. **Cross-Document Rate Tracking**: Longitudinal matching and arithmetic tracking across revisions and amendments.

Every number and table structure in this corpus is reproducible from stated mathematical and relational rules.

---

## Hard Constraints & Ground Rules
- **Synthetic Parties**: 
  - **Carrier**: `AEROVENTURE AIRLINES S.A.` (Fictional)
  - **Handling Company**: `NEXUS GROUND HANDLING SERVICES LTD.` (Fictional)
  - **Station**: `Athens International Airport (ATH / LGAV)`
- **Synthetic Footer**: Every page contains `SYNTHETIC TEST DOCUMENT — NOT A REAL AGREEMENT` in the footer.
- **Selectable Text**: Digitally generated vector PDFs with 100% extractable text (no raster/OCR dependency).
- **Verbatim Indexation Clause** (Document A, sub-clause 2.7):
  > *"2.7 With effect from 01 April 2023 and on each anniversary thereafter, all charges set out in Paragraph 1 shall be increased by three per cent (3.00%) per annum, compounded annually, rounded to two decimal places."*

---

## Arithmetic & Tracking Rules (v2 Updates)
1. **Indexation Formula**: `uplifted_rate = round(previous_rate * 1.03, 2)` (Commercial standard: `ROUND_HALF_UP`).
2. **Compounding Rule**: Document C rates are computed directly from Document B (`round(B * 1.03, 2)`), not from Document A.
3. **Non-Numeric Cells**: `FREE`, `centralized`, `at cost`, `on request (R)`, and word values remain unchanged.
4. **Percentages**: Percentage surcharges (e.g. `5.25%`, `25.00%`) are fixed contractual ratios and do not get index-uplifted.
5. **Row Continuity Rule**: Every row is carried forward in B and C unless a mapping case explicitly removes it. Row counts only change where M4 (`+1` row in C's ramp) and M5 (`-1` row in C's support) dictate.
6. **Scoped Column Rename (M6)**: Header `SGHA 2018` is renamed to `SGHA Ref` **only** in Document C's `ramp_services`. In `support_services` and `passenger_services`, the header remains `SGHA 2018` so M5 stays clean.
7. **Complete Copy for M3**: Document D's `passenger_services` is a complete 12-row copy of Document A's schedule with identical values.

---

## Corpus Timeline & Document Relationships

| Document | File | Effective Dates | Relationship | Purpose Tested |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `A_AnnexB_1.0_2022.pdf` | 01 Apr 2022 → 31 Mar 2025 | *Base Agreement* | Baseline schedules, all 12 table categories, stress cases S1–S10 |
| **B** | `B_RateRevision_2023.pdf` | 01 Apr 2023 → 31 Mar 2024 | `amends A` | Pure 3.00% CPI uplift, values only (M1) |
| **C** | `C_RateRevision_2024.pdf` | 01 Apr 2024 → 31 Mar 2025 | `amends B` | Compounded CPI uplift, added row (M4), removed row (M5), renamed column in ramp only (M6) |
| **D** | `D_Amendment_1_2024.pdf` | 01 Oct 2024 → 31 Mar 2025 | `amends A` | Liability update, new tiered de-icing schedule (M7), complete 12-row byte-identical table (M3) |
| **E** | `E_AnnexB_2.0_2025.pdf` | 01 Apr 2025 → 31 Mar 2028 | `supersedes A` | Restructured tables: 1→2 split and 2→1 merge (M8) |

---

## Deliberate Parser Stress Cases (S1 – S10)

| ID | Description | Document | Page | Expected Parser Behavior |
| :--- | :--- | :---: | :---: | :--- |
| **S1** | **Prose that looks tabular**: Numbered sub-clauses (2.1–2.7) with hanging indent. | **A** | Page 2 | Classified as `Not A Table` or ignored; must not create false table cells. |
| **S2** | **Column-aligned neighbours**: `RAMP SERVICES` and `SUPPORT SERVICES` on the same page with identical column x-positions, separated by 3 prose paragraphs. | **A** | Page 3 | Extracted as two separate tables, preserving intervening prose in reading order. |
| **S3** | **Merged banner cell**: Full-width title row directly spanning all table columns. | **A, B, C, D, E** | Various | Treated as a table caption/title banner rather than a data row. |
| **S4** | **Wrapped header**: Notification/signature block header wrapping party name across two lines. | **A, B, C, D, E** | Last | Preserved as a single table without being split into sub-tables. |
| **S5** | **Page-spanning table**: `PASSENGER SERVICES` breaks across page boundary with repeated header. | **A** | Pages 4–5 | Recovered as a single logical table with all rows preserved. |
| **S6** | **Unruled aligned list**: 2-column ground equipment rates without border grid lines. | **A** | Page 5 | Ground truth flags `is_ruled: false`; pipeline measured on whether it extracts aligned pairs. |
| **S7** | **Empty corner header**: Labor overtime table with blank top-left cell (`["", "Straight Time", ...]`). | **A** | Page 4 | First column recognized as row labels, remaining columns as data headers. |
| **S8** | **Ragged rows**: Scope matrix with legitimate trailing empty cells. | **A** | Page 1 | Matrix dimensions preserved without truncation of trailing blank cells. |
| **S9** | **Mixed currency and encoding**: Contains `€`, `$`, `USD`, and non-ASCII Greek (`Λεωφόρος Βασιλέως Κωνσταντίνου`) and German (`Straßburger Straße`) characters. | **A** | Page 5 | UTF-8 characters and distinct currencies extracted cleanly without mojibake. |
| **S10**| **Blank separator row**: Fully empty row separating narrow-body and wide-body turnaround services. | **A** | Page 2 | Single table preserved with empty separator row or grouped sections. |

---

## Cross-Document Mapping Cases (M1 – M8)

| Case | Document Mapping | `signature_should_match` | `fuzzy_should_match` | Test Purpose & Verification Rule |
| :--- | :--- | :---: | :---: | :--- |
| **M1** | Doc A `ramp_services` → Doc B `ramp_services` | `true` | `true` | Pure clean CPI indexation: `round(A * 1.03, 2)`. |
| **M2** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | Compounded multi-year indexation with column rename `SGHA 2018` → `SGHA Ref`. |
| **M3** | Doc A `passenger_services` → Doc D `passenger_services` | `true` | `true` | Complete 12-row copy; byte-identical table data. |
| **M4** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | `ELECTRIC TOWBARLESS TRACTOR` added as new row. |
| **M5** | Doc B `support_services` → Doc C `support_services` | `true` | `true` | `CREW TRANSPORT — OFF-AIRPORT` removed; headers remain `SGHA 2018`. |
| **M6** | Doc B `ramp_services` → Doc C `ramp_services` | `false` | `true` | Column renamed from `SGHA 2018` to `SGHA Ref` in ramp only. |
| **M7** | None → Doc D `deicing_services` | `false` | `false` | Tiered de-icing schedule has no predecessor; no forced match. |
| **M8** | Doc A `ramp_services` → Doc E `ramp_arrival` + `ramp_departure` | `false` | `false` | 1→2 table split and 2→1 table merge flagged for manual confirmation. |

---

## All 12 Required Table Categories in Document A

1. **Contract Metadata**: Cover Block (`table_key: "contract_metadata"`, Page 1)
2. **Tiered Pricing**: MTOW Turnaround Basic Charges (`table_key: "tiered_pricing"`, Page 2)
3. **Rate Schedule (Ramp)**: Ramp Services Rate Card (`table_key: "ramp_services"`, Page 3)
4. **Rate Schedule (Support)**: Support Services Rate Card (`table_key: "support_services"`, Page 3)
5. **Rate Schedule (Passenger)**: Passenger Services Card (`table_key: "passenger_services"`, Page 4)
6. **Staffing & Resourcing**: Staffing Allocation (`table_key: "staffing_resourcing"`, Page 4)
7. **SLA / Performance Target**: Service Level Standards (`table_key: "sla_performance"`, Page 5)
8. **Surcharge & Penalty**: Service Credits & Penalties (`table_key: "surcharge_penalty"`, Page 5)
9. **Liability Limit**: Aircraft Incident Limits (`table_key: "liability_limit"`, Page 6)
10. **Payment Schedule**: Invoicing & Settlement Schedule (`table_key: "payment_schedule"`, Page 6)
11. **Deadline / Milestone**: Contract Milestones & Audit Timetable (`table_key: "contract_milestones"`, Page 6)
12. **Scope & Services Matrix**: Annex A Included/Excluded Matrix (`table_key: "scope_and_services"`, Page 1)
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")
    print(f"Built README.md: {output_path}")


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    print(f"Generating synthetic IATA AHM 810 corpus (v2) in: {base_dir}")
    
    pdf_a = os.path.join(base_dir, "A_AnnexB_1.0_2022.pdf")
    pdf_b = os.path.join(base_dir, "B_RateRevision_2023.pdf")
    pdf_c = os.path.join(base_dir, "C_RateRevision_2024.pdf")
    pdf_d = os.path.join(base_dir, "D_Amendment_1_2024.pdf")
    pdf_e = os.path.join(base_dir, "E_AnnexB_2.0_2025.pdf")
    gt_path = os.path.join(base_dir, "ground_truth.json")
    readme_path = os.path.join(base_dir, "README.md")
    
    build_pdf_A(pdf_a)
    build_pdf_B(pdf_b)
    build_pdf_C(pdf_c)
    build_pdf_D(pdf_d)
    build_pdf_E(pdf_e)
    build_ground_truth(gt_path)
    build_readme(readme_path)
    
    print("\nCorpus generation v2 complete.")


if __name__ == "__main__":
    main()
