import fitz  # PyMuPDF

def extract_text_with_bboxes(pdf_path):
    doc = fitz.open(pdf_path)
    extracted_data = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        blocks = page.get_text("blocks")  # Extracts text blocks with bounding boxes

        for block in blocks:
            text = block[4].strip()  # Extract text
            bbox = block[:4]  # Bounding box (x0, y0, x1, y1)
            extracted_data.append({
                "text": text,
                "bbox": bbox,
                "page": page_num + 1
            })

    return extracted_data
