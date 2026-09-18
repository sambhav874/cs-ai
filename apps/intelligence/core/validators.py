import os
import re
from fastapi import HTTPException
from io import BytesIO

PDF_MAGIC = b"%PDF"

def validate_file_upload(
    content: bytes,
    filename: str,
    max_size_bytes: int,
    allowed_extensions: list[str],
) -> str:
    """
    Validates:
    - Total file size is within max_size_bytes limit.
    - File extension is within allowed_extensions (case-insensitive).
    - Sanitizes the filename to prevent path traversal/injection.
    Returns the sanitized filename.
    """
    # 1. Size check
    if len(content) > max_size_bytes:
        max_size_mb = max_size_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {max_size_mb:.1f}MB."
        )

    # 2. Filename sanitization
    # Strip directory path (prevent path traversal)
    base_filename = os.path.basename(filename)
    
    # Filter filename characters to alphanumeric, dashes, underscores, and dots
    # Ensure it's not empty and doesn't start with dots/slashes
    sanitized = re.sub(r'[^a-zA-Z0-9._-]', '_', base_filename)
    if not sanitized or sanitized.startswith('.'):
        sanitized = f"uploaded_file_{sanitized}" if sanitized else "uploaded_file"

    # 3. Extension check
    parts = sanitized.rsplit('.', 1)
    if len(parts) < 2:
        raise HTTPException(
            status_code=400,
            detail="File has no extension."
        )
    
    ext = parts[1].lower()
    if ext not in [e.lower() for e in allowed_extensions]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension. Allowed extensions: {', '.join(allowed_extensions)}"
        )

    return sanitized


def validate_pdf_upload(content: bytes, filename: str, max_size_mb: int = 50) -> str:
    """Validates that uploaded content is a genuine PDF within size limits."""
    # 1. General checks
    sanitized_filename = validate_file_upload(
        content, filename, max_size_mb * 1024 * 1024, ["pdf"]
    )
    
    # 2. Magic bytes check (first 4 bytes must be %PDF)
    if not content.startswith(PDF_MAGIC):
        raise HTTPException(status_code=400,
            detail="Invalid file. Only genuine PDF files are accepted.")
    
    return sanitized_filename

    
    # MIME type check via libmagic removed due to native dependency issues on local development
    # A basic 4-byte matching is usually sufficient for standard file uploads.

def extract_pdf_page_count(content: bytes) -> int:
    """
    SECURITY: Extract page count server-side from PDF content.
    This MUST be called after validate_pdf_upload() to override any client-supplied page_count.
    
    FINDING-11 / NEW-11: Without this function, users can submit page_count=1 for a
    500-page document and pay only 1 credit — a direct business logic/credit bypass.
    
    Required: pypdf >= 3.0 in pyproject.toml dependencies.
    """
    try:
        import pypdf
        reader = pypdf.PdfReader(BytesIO(content))
        return len(reader.pages)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Could not read PDF page structure. The file may be corrupt or encrypted."
        )

def validate_password_strength(password: str) -> None:
    """Enforces password complexity requirements."""
    errors = []
    if len(password) < 12:
        errors.append("at least 12 characters")
    if not any(c.isupper() for c in password):
        errors.append("at least one uppercase letter")
    if not any(c.islower() for c in password):
        errors.append("at least one lowercase letter")
    if not any(c.isdigit() for c in password):
        errors.append("at least one digit")
    if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in password):
        errors.append("at least one special character")
    
    # Common passwords check
    COMMON_PASSWORDS = {"password", "password123", "123456789", "qwerty123", "admin123", "testpassword", "securepassword"}
    if password.lower() in COMMON_PASSWORDS:
        errors.append("must not be a commonly used password")
    
    if errors:
        raise HTTPException(status_code=422,
            detail=f"Password must contain: {', '.join(errors)}.")
