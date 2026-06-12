from celery import Celery, shared_task, chain, signature
from celery.utils.log import get_task_logger
from datetime import datetime
from pathlib import Path
import asyncio
import inspect
import shutil
import time
import psutil
from bson import ObjectId
from typing import List, Dict, Any , Optional , Union
import requests
import socket
import json
from ipaddress import ip_address
import os
import secrets
import tempfile
import stat
import html
from urllib.parse import urlparse
import re
from azure.core.exceptions import AzureError
from celery_app import celery_app
# Define JobStatus enum if it's not properly imported
from enum import Enum, auto
from celery.exceptions import Ignore
class JobStatus(Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED" 
    FAILED = "FAILED"

from utils.helpers import JobManager
from core.config import Settings
from core.database import collection, db, fs, teams_collection, accounts_collection
from services.contract_agent.rag import ContractRAGSystem
from services.kpi_source_ingestion import KpiSourceIngestionService

from azure.communication.email import EmailClient
from jinja2 import Environment, FileSystemLoader, select_autoescape
from celery.exceptions import MaxRetriesExceededError

settings = Settings()
logger = get_task_logger(__name__)
job_manager = JobManager(settings.mongodb_uri)
from utils.secure_logger import log_exception  # Environment-gated exception logging


# Security constants
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_FILENAME_LENGTH = 255
MAX_CONTRACT_ID_LENGTH = 24  # MongoDB ObjectId length
MAX_USER_ID_LENGTH = 50
MAX_QUESTIONS = 100
MAX_QUESTION_LENGTH = 1000
MAX_CATEGORIES = 50
ALLOWED_FILE_EXTENSIONS = {'.pdf'}
TEMP_DIR_PREFIX = '/tmp'
REQUEST_TIMEOUT = 30
POLL_TIMEOUT = 15
MAX_POLL_ATTEMPTS = 60

# Progress ranges for each stage (overall percentages)
PROGRESS_RANGES = {
    "indexing": (0, 100),  # 0% to 100%
}

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal and injection attacks"""
    if not filename or len(filename) > MAX_FILENAME_LENGTH:
        raise ValueError(f"Invalid filename length. Must be 1-{MAX_FILENAME_LENGTH} characters.")
    
    # Remove path components and keep only the filename
    filename = os.path.basename(filename)
    
    # Remove or replace dangerous characters
    filename = re.sub(r'[^\w\s\-_\.]', '', filename)
    filename = filename.strip()
    
    if not filename:
        raise ValueError("Filename contains no valid characters")
    
    # Ensure it has a valid extension
    file_ext = Path(filename).suffix.lower()
    if file_ext not in ALLOWED_FILE_EXTENSIONS:
        raise ValueError(f"File extension '{file_ext}' not allowed. Allowed: {ALLOWED_FILE_EXTENSIONS}")
    
    return filename

def validate_object_id(obj_id_str: str, field_name: str) -> ObjectId:
    """Validate and convert ObjectId string with proper error handling"""
    if not obj_id_str:
        raise ValueError(f"{field_name} cannot be empty")
    
    if not isinstance(obj_id_str, str):
        raise ValueError(f"{field_name} must be a string")
    
    if len(obj_id_str) != MAX_CONTRACT_ID_LENGTH:
        raise ValueError(f"{field_name} must be exactly {MAX_CONTRACT_ID_LENGTH} characters")
    
    try:
        return ObjectId(obj_id_str)
    except Exception:
        raise ValueError(f"Invalid {field_name} format")

def validate_user_input(user_id: str, contract_id: str, questions: List[str] = None, 
                       categories: List[Dict[str, Any]] = None) -> None:
    """Validate all user inputs for security"""
    # Validate user_id
    if not user_id or not isinstance(user_id, str):
        raise ValueError("Invalid user_id")
    if len(user_id) > MAX_USER_ID_LENGTH:
        raise ValueError(f"user_id too long. Max length: {MAX_USER_ID_LENGTH}")
    if not re.match(r'^[a-zA-Z0-9_\-]+$', user_id):
        raise ValueError("user_id contains invalid characters")
    
    # Validate contract_id format (should be ObjectId compatible)
    if not contract_id or not isinstance(contract_id, str):
        raise ValueError("Invalid contract_id")
    if len(contract_id) != MAX_CONTRACT_ID_LENGTH:
        raise ValueError("Invalid contract_id length")
    
    # Validate questions if provided
    if questions is not None:
        if not isinstance(questions, list):
            raise ValueError("questions must be a list")
        if len(questions) > MAX_QUESTIONS:
            raise ValueError(f"Too many questions. Max: {MAX_QUESTIONS}")
        for i, question in enumerate(questions):
            if not isinstance(question, str):
                raise ValueError(f"Question {i} must be a string")
            if len(question) > MAX_QUESTION_LENGTH:
                raise ValueError(f"Question {i} too long. Max: {MAX_QUESTION_LENGTH}")
            # Basic XSS prevention
            if '<' in question or '>' in question or 'script' in question.lower():
                raise ValueError(f"Question {i} contains potentially dangerous content")
    
    # Validate categories if provided
    if categories is not None:
        if not isinstance(categories, list):
            raise ValueError("categories must be a list")
        if len(categories) > MAX_CATEGORIES:
            raise ValueError(f"Too many categories. Max: {MAX_CATEGORIES}")
        for i, category in enumerate(categories):
            if not isinstance(category, dict):
                raise ValueError(f"Category {i} must be a dictionary")



def create_secure_temp_directory() -> Path:
    """Create a secure temporary directory with proper permissions"""
    # Use secure random string for directory name
    random_suffix = secrets.token_hex(16)
    temp_dir = Path(tempfile.mkdtemp(prefix=f"secure_contract_{random_suffix}_", dir=TEMP_DIR_PREFIX))
    
    # Set restrictive permissions (owner only)
    os.chmod(temp_dir, stat.S_IRWXU)  # 700 permissions
    
    return temp_dir

def secure_file_write(file_path: Path, content: bytes, max_size: int = MAX_FILE_SIZE) -> None:
    """Securely write file content with size validation"""
    if len(content) > max_size:
        raise ValueError(f"File content exceeds maximum size of {max_size} bytes")
    
    # Create parent directory if needed
    file_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    
    # Write file with restrictive permissions
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Set file permissions (owner read/write only)
    os.chmod(file_path, stat.S_IRUSR | stat.S_IWUSR)  # 600 permissions

def validate_api_response(response_data: Dict[str, Any], required_fields: List[str]) -> None:
    """Validate API response data structure"""
    if not isinstance(response_data, dict):
        raise ValueError("Invalid API response format")
    
    for field in required_fields:
        if field not in response_data:
            raise ValueError(f"Missing required field in API response: {field}")

def calculate_stage_progress(stage: str, local_progress: float) -> float:
    """Convert local progress (0-100%) within a stage to global progress (0-100%)"""
    # Validate inputs
    if not isinstance(local_progress, (int, float)) or local_progress < 0 or local_progress > 100:
        local_progress = 0
    
    stage_start, stage_end = PROGRESS_RANGES.get(stage, (0, 100))
    stage_range = stage_end - stage_start
    
    # Convert local progress to global scale
    global_progress = stage_start + (local_progress / 100 * stage_range)
    return min(max(global_progress, stage_start), stage_end)  # Clamp to valid range

@celery_app.task(bind=True, name='fetch_kpi_source_task')
def fetch_kpi_source_task(self, source_config_id: str, triggered_by: str = "scheduled", user_id: Optional[str] = None, contract_id: Optional[str] = None):
    """Fetch one configured KPI source and evaluate tracked KPI actuals deterministically."""
    job_id = None
    try:
        config = db["contract_kpi_source_configs"].find_one({
            "source_config_id": source_config_id,
            "archived_at": {"$exists": False},
        })
        if not config:
            raise ValueError(f"KPI source config not found: {source_config_id}")

        effective_contract_id = contract_id or config.get("contract_id")
        effective_user_id = user_id or str(config.get("updated_by") or config.get("created_by") or "system")
        if ObjectId.is_valid(str(effective_contract_id)) and ObjectId.is_valid(str(effective_user_id)):
            job_id = job_manager.create_job(
                job_type="kpi_source_fetch",
                contract_id=str(effective_contract_id),
                user_id=str(effective_user_id),
                status="IN_PROGRESS",
            )
            job_manager.update_job_status(
                job_id=job_id,
                status="IN_PROGRESS",
                current_step="Fetching KPI actual source",
                progress=10,
            )
        service = KpiSourceIngestionService(db)
        result = service.fetch_source(
            contract_id=str(effective_contract_id),
            source_config_id=source_config_id,
            user_id=str(effective_user_id),
            trigger_type=triggered_by or "scheduled",
            evaluate=True,
        )
        if job_id:
            job_manager.update_job_status(
                job_id=job_id,
                status="COMPLETED",
                current_step="KPI source fetch completed",
                progress=100,
                message=(
                    f"KPI source fetch completed: {len(result.get('created_actuals') or [])} actuals, "
                    f"{len(result.get('created_breaches') or [])} evaluations"
                ),
            )
        return result
    except Exception as exc:
        log_exception(logger, f"KPI source fetch task failed for {source_config_id}", exc)
        if job_id:
            job_manager.update_job_status(
                job_id=job_id,
                status="FAILED",
                current_step="KPI source fetch failed",
                progress=100,
                error=str(exc),
            )
        raise


@celery_app.task(bind=True, name='run_due_kpi_source_fetches')
def run_due_kpi_source_fetches(self):
    """Queue all enabled KPI sources whose polling cadence is due."""
    now = datetime.utcnow()
    query = {
        "archived_at": {"$exists": False},
        "enabled": True,
        "next_run_at": {"$lte": now},
    }
    queued: List[Dict[str, Any]] = []
    for config in db["contract_kpi_source_configs"].find(query).limit(250):
        source_config_id = config.get("source_config_id")
        if not source_config_id:
            continue
        async_result = fetch_kpi_source_task.delay(
            str(source_config_id),
            triggered_by="scheduled",
            user_id=str(config.get("updated_by") or config.get("created_by") or "system"),
            contract_id=str(config.get("contract_id")),
        )
        queued.append({
            "source_config_id": str(source_config_id),
            "contract_id": str(config.get("contract_id")),
            "task_id": async_result.id,
        })
    return {
        "queued_count": len(queued),
        "queued": queued,
        "checked_at": now.isoformat(),
    }

@celery_app.task(bind=True, name='index_contract_task')
def index_contract_task(self, contract_id: str, contract_oid_str: str, file_id_str: str, 
                       file_name: str, use_local_marker: bool, user_id: str):
    """Celery task for contract indexing with enhanced security"""
    job_id = None 
    temp_process_dir = None
    
    try:
        validate_user_input(user_id, contract_id)
        sanitized_filename = sanitize_filename(file_name)
        contract_oid = validate_object_id(contract_oid_str, "contract_oid")
        file_id = validate_object_id(file_id_str, "file_id")
        
        job_id = job_manager.create_job(
            job_type="indexing",
            contract_id=contract_id,
            user_id=user_id,
            status="IN_PROGRESS"
        )
        
        job_manager.update_job_status(
            job_id=job_id,
            status="IN_PROGRESS",
            current_step="indexing",
            progress=calculate_stage_progress("indexing", 5)
        )
        
        pdf_content = None
        grid_out = None
        try:
            grid_out = fs.get(file_id)
            pdf_content = grid_out.read()
            if not pdf_content:
                raise ValueError("Cannot index empty file content.")
            if len(pdf_content) > MAX_FILE_SIZE:
                raise ValueError(f"File size exceeds maximum allowed size of {MAX_FILE_SIZE} bytes")
        finally:
            if grid_out:
                grid_out.close()

        job_manager.update_job_status(
            job_id=job_id,
            status="IN_PROGRESS",
            current_step="indexing",
            progress=calculate_stage_progress("indexing", 20)
        )

        temp_process_dir = create_secure_temp_directory()
        temp_pdf_path = temp_process_dir / sanitized_filename

        try:
            secure_file_write(temp_pdf_path, pdf_content)

            job_manager.update_job_status(
                job_id=job_id,
                status="IN_PROGRESS",
                current_step="indexing",
                progress=calculate_stage_progress("indexing", 40)
            )

            marker_result = _process_with_marker(
                temp_pdf_path, sanitized_filename, contract_id, use_local_marker
            )

            if not isinstance(marker_result, dict) or "markdown" not in marker_result:
                raise ValueError("Invalid content returned from marker processing")
                
            from core.sanitizers import sanitize_llm_input
            raw_index_content = marker_result.get("markdown", "")
            index_content = sanitize_llm_input(raw_index_content)
            
            index_html_content = marker_result.get("html", "")
            index_images = marker_result.get("images", {})
            index_page_count = marker_result.get("page_count", 0)
            index_parse_quality_score = marker_result.get("parse_quality_score", 0.0)
            index_cost_breakdown = marker_result.get("cost_breakdown", {})
            index_error = marker_result.get("error", "")
            index_parser = marker_result.get("parser", "marker")

            job_manager.update_job_status(
                job_id=job_id,
                status="IN_PROGRESS",
                current_step="embedding",
                progress=calculate_stage_progress("indexing", 65)
            )

            vector_namespace = f"contract-{contract_id}"
            contract_record = collection.find_one(
                {"_id": contract_oid},
                {"projectId": 1}
            ) or {}
            project_id = contract_record.get("projectId")
            project_id_str = str(project_id) if project_id else None
            try:
                rag_system = ContractRAGSystem(ai_provider="groq")
                embedding_metadata = rag_system.embed_contract_text(
                    index_content,
                    sanitized_filename,
                    contract_id=contract_id,
                    project_id=project_id_str,
                    user_id=user_id,
                    namespace=vector_namespace,
                    replace_existing=True,
                    require_mongodb=True,
                )
            except Exception as embed_error:
                log_exception(logger, f"Failed to embed extracted text for contract {contract_id}", embed_error)
                raise RuntimeError("Failed to embed extracted contract text in MongoDB") from embed_error

            job_manager.update_job_status(
                job_id=job_id,
                status="IN_PROGRESS",
                current_step="indexing",
                progress=calculate_stage_progress("indexing", 80)
            )


            update_result = collection.update_one(
                {"_id": contract_oid},
                { 
                    "$set": { 
                        "index.status": "success", 
                        "index.content": index_content, 
                        "index.html_content": index_html_content,
                        "index.images": index_images,
                        "index.page_count": index_page_count,
                        "index.parser": index_parser,
                        "index.parse_quality_score": index_parse_quality_score,
                        "index.error": index_error,
                        "index.embedding_status": "success",
                        "index.vector_namespace": embedding_metadata.get("namespace"),
                        "index.vector_backend": embedding_metadata.get("backend"),
                        "index.vector_collection": embedding_metadata.get("collection"),
                        "index.vector_count": embedding_metadata.get("chunk_count", 0),
                        "index.project_id": project_id_str,
                        "index.segment_count": embedding_metadata.get("segment_count", 0),
                        "index.chunk_schema_version": embedding_metadata.get("chunk_schema_version"),
                        "index.embedding_backend": embedding_metadata.get("embedding_backend"),
                        "index.embedding_dimension": embedding_metadata.get("embedding_dimension"),
                        "index.embedded_at": datetime.utcnow(),
                        "index.updated_at": datetime.utcnow(), 
                        "status": "Indexed",
                        "credits_deducted": True
                    }
                }
            )
            
            job_manager.update_job_status(
                job_id=job_id,
                status="COMPLETED",
                current_step="indexing",
                progress=calculate_stage_progress("indexing", 100)
            )
            
            return {
                "status": "success",
                "contract_id": contract_id,
                "index_content": index_content,
                "vector_namespace": embedding_metadata.get("namespace"),
            }
            
        finally:
            if temp_process_dir and temp_process_dir.exists():
                for file_path in temp_process_dir.rglob('*'):
                    if file_path.is_file():
                        try:
                            file_size = file_path.stat().st_size
                            with open(file_path, 'wb') as f:
                                f.write(secrets.token_bytes(file_size))
                        except Exception as e:
                            logger.warning(f"Failed to securely overwrite {file_path}: {e}")
                shutil.rmtree(temp_process_dir, ignore_errors=True)
                
    except Exception as e:
        logger.error(f"Indexing failed for contract {contract_id}: {str(e)}")
        if job_id:
            job_manager.update_job_status(job_id, "FAILED", str(e))
        error_msg = "Indexing failed due to processing error"
        collection.update_one(
            {"_id": contract_oid},
            {"$set": {
                "index.status": "error",
                "index.error": error_msg,
                "index.embedding_status": "failed",
                "index.updated_at": datetime.utcnow(),
                "status": "Index Error"
            }}
        )
        raise self.retry(exc=e, countdown=60, max_retries=3)


def _process_with_marker(temp_pdf_path: Path, file_name: str,
                        contract_id: str, use_local_marker: bool) -> Dict[str, Any]:
    """Helper function to process with Marker (local or external) with security enhancements"""
    if use_local_marker:
        try:
            from utils.marker_processor import MarkerProcessor
            marker_processor = MarkerProcessor()
            
            # Create secure output directory
            output_dir = create_secure_temp_directory()
            try:
                result = marker_processor.process_document(str(temp_pdf_path), str(output_dir))
                if not isinstance(result, str):
                    raise ValueError("Invalid result from local marker processor")
                return {"markdown": result, "html": ""}
            finally:
                if output_dir.exists():
                    shutil.rmtree(output_dir, ignore_errors=True)
                    
        except ImportError:
            logger.warning("Local marker not available, falling back to external API")
            return _process_with_external_marker(temp_pdf_path, file_name, contract_id)
    else:
        return _process_with_external_marker(temp_pdf_path, file_name, contract_id)

def _build_liteparse_parser(liteparse_cls: Any, *, ocr_enabled: bool) -> Any:
    """Create a LiteParse parser through the Python package API."""
    init_params = inspect.signature(liteparse_cls).parameters
    kwargs: Dict[str, Any] = {}
    parser_options = {
        "ocr_enabled": ocr_enabled,
        "ocr_language": "eng",
        "max_pages": 10000,
        "dpi": 150,
        "preserve_very_small_text": True,
        "quiet": True,
    }

    for key, value in parser_options.items():
        if key in init_params:
            kwargs[key] = value

    return liteparse_cls(**kwargs)

async def _run_liteparse_parse(parser: Any, file_path: str, *, ocr_enabled: bool) -> Any:
    """Run LiteParse via its Python API, supporting both stable and native wheels."""
    parse_options = {
        "ocr_enabled": ocr_enabled,
        "ocr_language": "eng",
        "max_pages": 10000,
        "dpi": 150,
        "preserve_very_small_text": True,
        "precise_bounding_box": True,
        "timeout": 120,
    }

    if hasattr(parser, "parse_async"):
        parse_method = parser.parse_async
        parse_params = inspect.signature(parse_method).parameters
        kwargs = {
            key: value
            for key, value in parse_options.items()
            if key in parse_params
        }
        return await parse_method(file_path, **kwargs)

    parse_method = parser.parse
    parse_params = inspect.signature(parse_method).parameters
    kwargs = {
        key: value
        for key, value in parse_options.items()
        if key in parse_params
    }
    return await asyncio.wait_for(
        asyncio.to_thread(parse_method, file_path, **kwargs),
        timeout=120,
    )

def _liteparse_page_text(page: Any) -> str:
    if isinstance(page, dict):
        text = page.get("text") or page.get("markdown") or ""
        if text:
            return text
        text_items = page.get("textItems") or []
        if isinstance(text_items, list):
            return "\n".join(
                item.get("text", "").strip()
                for item in text_items
                if isinstance(item, dict) and item.get("text")
            )
        return ""

    return getattr(page, "text", "") or getattr(page, "markdown", "") or ""

def _liteparse_page_number(page: Any, fallback: int) -> int:
    if isinstance(page, dict):
        value = page.get("page_num") or page.get("pageNum") or page.get("page")
    else:
        value = getattr(page, "page_num", None) or getattr(page, "pageNum", None)

    try:
        page_number = int(value)
        return page_number if page_number > 0 else fallback
    except (TypeError, ValueError):
        return fallback

def _liteparse_result_to_text(result: Any) -> str:
    """Convert LiteParse page output to text with stable page markers."""
    pages = getattr(result, "pages", None)
    if pages is None and isinstance(result, dict):
        pages = result.get("pages")
    pages = pages or []

    if not pages:
        if isinstance(result, dict):
            return result.get("text", "") or ""
        return getattr(result, "text", "") or ""

    content_with_markers = []
    for index, page in enumerate(pages, 1):
        page_num = _liteparse_page_number(page, index)
        page_text = _liteparse_page_text(page).strip()
        if page_text:
            content_with_markers.append(f"--- Page {page_num} ---\n\n{page_text}")

    return "\n\n".join(content_with_markers)

def _liteparse_runtime_error(exc: Exception) -> RuntimeError:
    """Include LiteParse stderr in parse errors."""
    message = str(exc)
    stderr = getattr(exc, "stderr", None)
    if stderr:
        stderr_text = str(stderr).strip()
        if stderr_text:
            message = f"{message}: {stderr_text[:1000]}"
    return RuntimeError(f"LiteParse failed to parse the PDF: {message}")

def _process_with_liteparse(temp_pdf_path: Path, file_name: str, contract_id: str) -> Dict[str, Any]:
    """Process document using LiteParse when Marker API credentials are unavailable."""
    try:
        from liteparse import LiteParse
    except ImportError as exc:
        raise ImportError("The liteparse Python package is required to process PDF files.") from exc

    markdown = ""
    page_count = 0
    last_error: Optional[Exception] = None

    for ocr_enabled in (False, True):
        parser = _build_liteparse_parser(LiteParse, ocr_enabled=ocr_enabled)
        try:
            result = asyncio.run(
                _run_liteparse_parse(
                    parser,
                    str(temp_pdf_path),
                    ocr_enabled=ocr_enabled,
                )
            )
            markdown = _liteparse_result_to_text(result)
            pages = getattr(result, "pages", None)
            if pages is None and isinstance(result, dict):
                pages = result.get("pages")
            page_count = len(pages or []) or (1 if markdown.strip() else 0)
            if markdown.strip() or ocr_enabled:
                break
        except Exception as exc:
            last_error = exc
            if not ocr_enabled:
                continue
            raise _liteparse_runtime_error(exc) from exc

    if not markdown.strip() and last_error:
        raise _liteparse_runtime_error(last_error) from last_error

    if not markdown.strip():
        raise ValueError("LiteParse returned no text content")

    result = {
        "status": "complete",
        "success": True,
        "markdown": markdown,
        "html": "",
        "images": {},
        "page_count": page_count,
        "parse_quality_score": 0.0,
        "cost_breakdown": {},
        "error": "",
        "parser": "liteparse",
    }
    logger.info(
        "LiteParse processed %s for contract %s with %s page(s)",
        file_name,
        contract_id,
        result.get("page_count", 0),
    )
    return result

def _validate_check_url(check_url: str) -> None:
    """Validate check URL to prevent SSRF, redirect loops, and private IP requests."""
    try:
        parsed_check = urlparse(check_url)
    except Exception:
        raise ValueError("Invalid check URL format")
    
    if parsed_check.scheme not in {"http", "https"}:
        raise ValueError("Invalid check URL scheme")
        
    if not parsed_check.hostname:
        raise ValueError("Check URL missing hostname")
        
    # Approved hosts: must match the hostname of settings.marker_api_url
    api_url = settings.marker_api_url
    if not api_url:
        raise ValueError("Marker API URL not configured")
    try:
        parsed_api = urlparse(api_url)
    except Exception:
        raise ValueError("Invalid Marker API URL configuration")
        
    if parsed_check.hostname.strip().lower() != parsed_api.hostname.strip().lower():
        raise ValueError("Check URL hostname does not match the approved Marker API host")
        
    # DNS check to block private/local/reserved IPs
    host = parsed_check.hostname.strip().lower()
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, parsed_check.port or (443 if parsed_check.scheme == "https" else 80), proto=socket.IPPROTO_TCP)}
    except OSError as exc:
        raise ValueError("Check URL hostname could not be resolved") from exc
        
    for resolved in addresses:
        try:
            addr = ip_address(resolved)
        except ValueError:
            raise ValueError("Check URL resolved to an invalid IP address")
            
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            raise ValueError("Check URL resolves to a private or reserved network address")

def _process_with_external_marker(temp_pdf_path: Path, file_name: str, contract_id: str) -> Dict[str, Any]:
    """Process document using external Marker API with enhanced security"""
    # Validate API configuration
    if not settings.marker_api_key:
        logger.info("Marker API key is not configured; using LiteParse fallback for %s", file_name)
        return _process_with_liteparse(temp_pdf_path, file_name, contract_id)

    if not settings.marker_api_url:
        raise ValueError("Marker API URL not configured")
    
    # Validate API URL
    try:
        parsed_url = urlparse(settings.marker_api_url)
        if not parsed_url.scheme in ['http', 'https']:
            raise ValueError("Invalid API URL scheme")
        if not parsed_url.netloc:
            raise ValueError("Invalid API URL")
    except Exception:
        raise ValueError("Invalid Marker API URL format")
    
    url = settings.marker_api_url
    headers = {"X-Api-Key": settings.marker_api_key}

    # Validate file size before sending
    file_size = temp_pdf_path.stat().st_size
    if file_size > MAX_FILE_SIZE:
        raise ValueError(f"File size {file_size} exceeds maximum {MAX_FILE_SIZE}")

    with open(temp_pdf_path, 'rb') as f:
            form_data = { 
                'file': (file_name, f, 'application/pdf'),
                'langs': (None, "English"),
                "force_ocr": (None, False),
                "paginate": (None, True),
                'output_format': (None, 'markdown,html'),
                "use_llm": (None, True),
                "strip_existing_ocr": (None, False),
                "disable_image_extraction": (None, False),
            }
            
            response = requests.post(
                url, 
                files=form_data, 
                headers=headers, 
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False  # Prevent redirect attacks
            )
            response.raise_for_status()
            
            try:
                initial_response = response.json()
            except Exception:
                raise ValueError("Invalid JSON response from Marker API")
            
            # Validate API response structure
            validate_api_response(initial_response, ["request_check_url"])
            
            check_url = initial_response.get("request_check_url")
            if not check_url:
                raise ValueError("Marker response missing 'request_check_url'")
            
            # Validate check URL
            _validate_check_url(check_url)

            # Poll for results with security limits
            max_polls = min(MAX_POLL_ATTEMPTS, 60)  # Cap at reasonable limit
            poll_interval = 5
            
            for i in range(max_polls):
                time.sleep(poll_interval)
                
                try:
                    _validate_check_url(check_url)
                    poll_response = requests.get(
                        check_url, 
                        headers=headers, 
                        timeout=POLL_TIMEOUT,
                        allow_redirects=False,
                        stream=True
                    )
                    poll_response.raise_for_status()
                    
                    # Read response in chunks to enforce bounded size
                    content = bytearray()
                    max_size = 10 * 1024 * 1024  # 10MB limit
                    for chunk in poll_response.iter_content(chunk_size=65536):
                        if chunk:
                            content.extend(chunk)
                            if len(content) > max_size:
                                poll_response.close()
                                raise ValueError("Marker response exceeded safe size limit")
                                
                    try:
                        poll_data = json.loads(content.decode("utf-8"))
                    except Exception:
                        raise ValueError("Invalid JSON response from Marker API")
                    
                    if poll_data.get("status") == "complete":
                        return {
                            "status": poll_data.get("status", "complete"),
                            "success": poll_data.get("success", True),
                            "markdown": poll_data.get("markdown", ""),
                            "html": poll_data.get("html", ""),
                            "images": poll_data.get("images", {}),
                            "page_count": poll_data.get("page_count", 0),
                            "parse_quality_score": poll_data.get("parse_quality_score", 0.0),
                            "cost_breakdown": poll_data.get("cost_breakdown", {}),
                            "error": poll_data.get("error", "")
                        }
                    if poll_data.get("status") == "failed":
                        raise Exception(f"Marker API failed: {poll_data.get('error', 'Unknown error')}")
                        
                    # Report progress on polling (allows for feedback during long external processing)
                    job_id = None
                    try:
                        jobs = job_manager.jobs.find({"contract_id": ObjectId(contract_id), "job_type": {"$in": ["indexing", "processing"]}})
                        latest_job = list(jobs.sort("created_at", -1).limit(1))
                        if latest_job:
                            job_id = latest_job[0].get("job_id")
                            job_type = latest_job[0].get("job_type", "indexing")
                            if job_id:
                                # Calculate poll progress (5% to 95%)
                                poll_progress = 5 + ((i / max_polls) * 90)
                                job_manager.update_job_status(
                                    job_id=job_id,
                                    status="IN_PROGRESS",
                                    current_step=job_type,
                                    progress=calculate_stage_progress(job_type, poll_progress)
                                )
                    except Exception as e:
                        logger.warning(f"Failed to update job progress during polling: {e}")
                    
                except Exception as e:
                    logger.error(f"Error polling Marker API: {str(e)}")
                    raise
                
            raise Exception("Marker API polling timed out")
    

def render_email_template(template_name: str, context: dict) -> str:
    """Renders an HTML template with the given context."""
    # This assumes your 'templates' folder is at the same level as your tasks.py
    # Adjust the path if necessary, e.g., 'apps/backend/templates'
    template_loader = FileSystemLoader(searchpath=Path(__file__).parent.parent / "templates")
    env = Environment(loader=template_loader, autoescape=select_autoescape(['html', 'xml']))
    template = env.get_template(template_name)
    return template.render(context)


@celery_app.task(bind=True, name="tasks.send_kpi_alert_email", max_retries=3)
def send_kpi_alert_email_task(self, recipients: List[str], subject: str, body: str, alert: Optional[Dict[str, Any]] = None):
    """Send a ContractSense KPI alert email through Azure Communication Services."""
    clean_recipients = [str(recipient).strip() for recipient in recipients or [] if str(recipient).strip()]
    if not clean_recipients:
        return {"status": "skipped", "reason": "No recipients supplied"}

    try:
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)
        alert_payload = alert or {}
        safe_subject = html.escape(subject or "ContractSense KPI alert")
        safe_body = html.escape(body or "A ContractSense KPI alert requires review.").replace("\n", "<br />")
        html_content = f"""
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <h2 style="margin: 0 0 12px;">{safe_subject}</h2>
          <p>{safe_body}</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="font-size: 13px; color: #6b7280;">
            Contract ID: {html.escape(str(alert_payload.get('contract_id') or 'N/A'))}<br />
            KPI ID: {html.escape(str(alert_payload.get('kpi_id') or 'N/A'))}<br />
            Severity: {html.escape(str(alert_payload.get('severity') or 'N/A'))}
          </p>
        </div>
        """
        message_payload = {
            "content": {
                "subject": subject,
                "html": html_content,
            },
            "recipients": {
                "to": [{"address": recipient} for recipient in clean_recipients],
            },
            "senderAddress": settings.azure_sender_address,
        }
        poller = email_client.begin_send(message_payload)
        send_result = poller.result()
        message_id = send_result.get("id")
        if message_id:
            logger.info("Successfully sent KPI alert email. Message ID: %s", message_id)
            return {"status": "success", "message_id": message_id}
        raise Exception("Azure email send operation failed to return a message ID.")
    except MaxRetriesExceededError:
        logger.critical("Failed to send KPI alert email after multiple retries.")
        return {"status": "failed", "reason": "Max retries exceeded"}
    except AzureError as e:
        log_exception(logger, "Azure error while sending KPI alert email", e)
        raise self.retry(exc=e, countdown=10)
    except Exception as e:
        log_exception(logger, "Unexpected error while sending KPI alert email", e)
        raise self.retry(exc=e, countdown=10)


# --- New Celery Task for Sending Beta Welcome Email ---
@celery_app.task(bind=True, name="tasks.send_beta_welcome_email", max_retries=3)
def send_beta_welcome_email_task(self, recipient_email: str, name: str, coupon_code: str):
    """
    Celery task to send a welcome email to a new beta applicant using Azure Communication Services.
    """
    logger.info(f"Attempting to send beta welcome email to: {recipient_email}")

    try:
        # 1. Initialize the Azure Email Client using the connection string from settings
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)

        # 2. Prepare the email content by rendering the HTML template
        html_content = render_email_template(
            "welcome_email.html",
            {"name": name, "coupon_code": coupon_code}
        )
 
        # 3. Construct the message payload as required by the Azure SDK
        message = {
            "content": {
                "subject": "🎉 Welcome to Our Beta! Here's Your Code",
                "html": html_content
            },
            "recipients": {
                "to": [{"address": recipient_email}]
            },
            "senderAddress": settings.azure_sender_address
        }

        # 4. Send the email
        # The begin_send method returns a poller object to track the status.
        poller = email_client.begin_send(message)
        
        # We can wait for the result to confirm it was sent or log the message ID
        send_result = poller.result()
        message_id = send_result.get('id')
        
        if message_id:
            logger.info(f"Successfully sent beta email to {recipient_email}. Message ID: {message_id}")
            return {"status": "success", "message_id": message_id}
        else:
            logger.error(f"Email send operation for {recipient_email} did not return a message ID. Result: {send_result}")
            raise Exception("Azure email send operation failed to return a message ID.")

    except MaxRetriesExceededError:
        logger.critical(f"Failed to send email to {recipient_email} after multiple retries. Giving up.")
        # You could add logic here to flag this user in the DB for manual intervention.
        return {"status": "failed", "reason": "Max retries exceeded"}

    except AzureError as e:
        log_exception(logger, f"Azure error while sending beta welcome email to {recipient_email}", e)
        raise self.retry(exc=e, countdown=10)

    except Exception as e:
        log_exception(logger, f"Unexpected error while sending welcome email to {recipient_email}", e)
        raise self.retry(exc=e, countdown=10)


@celery_app.task(bind=True, name="tasks.send_feedback_email", max_retries=3)
def send_feedback_email_task(self, feedback_type: str, user_email: str, name: str, message: str):
    """
    Celery task to send feedback/support/bug report emails using Azure Communication Services.
    """
    logger.info(f"Attempting to send {feedback_type} email from: {user_email}")

    try:
        # 1. Initialize the Azure Email Client
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)

        # 2. Prepare the email content by rendering the HTML template
        html_content = render_email_template(
            "feedback_email.html",
            {
                "feedback_type": feedback_type.capitalize(),
                "user_email": user_email,
                "name": name or "N/A",
                "message": message,
            }
        )

        # 3. Construct the message payload
        subject = f"New {feedback_type.capitalize()} Report from {name or user_email}"
        
        message_payload = {
            "content": {
                "subject": subject,
                "html": html_content
            },
            "recipients": {
                "to": [{"address": settings.support_email_address}]
            },
            "senderAddress": settings.azure_sender_address,
            "replyTo": [{"address": user_email, "displayName": name}]
        }

        # 4. Send the email
        poller = email_client.begin_send(message_payload)
        send_result = poller.result()
        message_id = send_result.get('id')

        if message_id:
            logger.info(f"Successfully sent {feedback_type} email. Message ID: {message_id}")
            return {"status": "success", "message_id": message_id}
        else:
            logger.error(f"Email send for {user_email} did not return a message ID. Result: {send_result}")
            raise Exception("Azure email send operation failed to return a message ID.")

    except MaxRetriesExceededError:
        logger.critical(f"Failed to send {feedback_type} email from {user_email} after multiple retries.")
        return {"status": "failed", "reason": "Max retries exceeded"}

    except AzureError as e:
        log_exception(logger, f"Azure error while sending {feedback_type} email", e)
        raise self.retry(exc=e, countdown=10)

    except Exception as e:
        log_exception(logger, f"Unexpected error while sending {feedback_type} email", e)
        raise self.retry(exc=e, countdown=10)


@celery_app.task(bind=True, name="tasks.send_contact_email", max_retries=3)
def send_contact_email_task(self, name: str, user_email: str, company: str | None, phone: str | None, message: str, source: str = "landing_modal"):
    """
    Celery task to send contact/demo request emails to support using Azure Communication Services.
    """
    logger.info(f"Attempting to send contact email from: {user_email}")

    try:
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)

        combined_message = (
            f"Company: {company or 'N/A'}\n"
            f"Phone: {phone or 'N/A'}\n\n"
            f"Message:\n{message or 'N/A'}\n"
        )

        html_content = render_email_template(
            "feedback_email.html",
            {
                "feedback_type": "Contact Request",
                "user_email": user_email,
                "name": name or "N/A",
                "message": combined_message,
            }
        )

        subject = f"Contact Request from {name or user_email}"

        message_payload = {
            "content": {
                "subject": subject,
                "html": html_content
            },
            "recipients": {
                "to": [{"address": settings.support_email_address}]
            },
            "senderAddress": settings.azure_sender_address,
            "replyTo": [{"address": user_email, "displayName": name}]
        }

        poller = email_client.begin_send(message_payload)
        send_result = poller.result()
        message_id = send_result.get('id')

        if message_id:
            logger.info(f"Successfully sent contact email from {user_email}. Message ID: {message_id}")
            return {"status": "success", "message_id": message_id}
        else:
            logger.error(f"Email send for {user_email} did not return a message ID. Result: {send_result}")
            raise Exception("Azure email send operation failed to return a message ID.")

    except MaxRetriesExceededError:
        logger.critical(f"Failed to send contact email from {user_email} after multiple retries.")
        return {"status": "failed", "reason": "Max retries exceeded"}

    except AzureError as e:
        log_exception(logger, "Azure error while sending contact email", e)
        raise self.retry(exc=e, countdown=10)

    except Exception as e:
        log_exception(logger, "Unexpected error while sending contact email", e)
        raise self.retry(exc=e, countdown=10)


@celery_app.task(bind=True, name="tasks.send_demo_confirmation_email", max_retries=3)
def send_demo_confirmation_email_task(self, name: str, user_email: str, demo_date: str, demo_time: str):
    """
    Celery task to send demo confirmation email to the user using Azure Communication Services.
    Includes the scheduled demo date and time.
    """
    logger.info(f"Attempting to send demo confirmation email to: {user_email}")

    try:
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)

        html_content = render_email_template(
            "demo_confirmation_email.html",
            {
                "name": name or "Guest",
                "demo_date": demo_date,
                "demo_time": demo_time,
            }
        )

        subject = f"Demo Scheduled: {demo_date} at {demo_time} UK Time"

        message_payload = {
            "content": {
                "subject": subject,
                "html": html_content
            },
            "recipients": {
                "to": [{"address": user_email}]
            },
            "senderAddress": settings.azure_sender_address,
        }

        poller = email_client.begin_send(message_payload)
        send_result = poller.result()
        message_id = send_result.get('id')

        if message_id:
            logger.info(f"Successfully sent demo confirmation email to {user_email}. Message ID: {message_id}")
            return {"status": "success", "message_id": message_id}
        else:
            logger.error(f"Email send for {user_email} did not return a message ID. Result: {send_result}")
            raise Exception("Azure email send operation failed to return a message ID.")

    except MaxRetriesExceededError:
        logger.critical(f"Failed to send demo confirmation email to {user_email} after multiple retries.")
        return {"status": "failed", "reason": "Max retries exceeded"}

    except AzureError as e:
        log_exception(logger, f"Azure error while sending demo confirmation email to {user_email}", e)
        raise self.retry(exc=e, countdown=10)

    except Exception as e:
        log_exception(logger, f"Unexpected error while sending demo confirmation email to {user_email}", e)
        raise self.retry(exc=e, countdown=10)

@celery_app.task(bind=True, name="tasks.send_contact_and_demo_confirmation", max_retries=3)
def send_contact_and_demo_confirmation(self, name: str, user_email: str, company: str | None, phone: str | None, message: str | None, demo_date: str | None = None, demo_time: str | None = None, source: str = "landing_modal"):
    """
    Combined Celery task that sends the contact email to support and, if demo details provided,
    also sends the demo confirmation email to the user.
    """
    logger.info(f"Attempting to send contact + confirmation emails from: {user_email}")

    try:
        email_client = EmailClient.from_connection_string(settings.azure_communication_connection_string)

        # Build contact/support email
        combined_message = (
            f"Company: {company or 'N/A'}\n"
            f"Phone: {phone or 'N/A'}\n\n"
            f"Message:\n{message or 'N/A'}\n"
        )

        html_contact = render_email_template(
            "feedback_email.html",
            {
                "feedback_type": "Contact Request",
                "user_email": user_email,
                "name": name or "N/A",
                "message": combined_message,
            }
        )

        subject_contact = f"Contact Request from {name or user_email}"

        contact_payload = {
            "content": {"subject": subject_contact, "html": html_contact},
            "recipients": {"to": [{"address": settings.support_email_address}]},
            "senderAddress": settings.azure_sender_address,
            "replyTo": [{"address": user_email, "displayName": name}],
        }

        poller_contact = email_client.begin_send(contact_payload)
        contact_result = poller_contact.result()
        contact_msg_id = contact_result.get('id')

        if contact_msg_id:
            logger.info(f"Successfully sent contact email from {user_email}. Message ID: {contact_msg_id}")
        else:
            logger.error(f"Contact email send did not return a message ID. Result: {contact_result}")
            raise Exception("Azure contact email send failed to return a message ID")

        confirmation_msg_id = None
        if demo_date and demo_time:
            html_confirm = render_email_template(
                "demo_confirmation_email.html",
                {"name": name or "Guest", "demo_date": demo_date, "demo_time": demo_time}
            )

            subject_confirm = f"Demo Scheduled: {demo_date} at {demo_time} UK Time"

            confirm_payload = {
                "content": {"subject": subject_confirm, "html": html_confirm},
                "recipients": {"to": [{"address": user_email}]},
                "senderAddress": settings.azure_sender_address,
            }

            poller_confirm = email_client.begin_send(confirm_payload)
            confirm_result = poller_confirm.result()
            confirmation_msg_id = confirm_result.get('id')

            if confirmation_msg_id:
                logger.info(f"Successfully sent demo confirmation email to {user_email}. Message ID: {confirmation_msg_id}")
            else:
                logger.error(f"Demo confirmation send did not return a message ID. Result: {confirm_result}")
                raise Exception("Azure confirmation email send failed to return a message ID")

        return {"status": "success", "contact_message_id": contact_msg_id, "confirmation_message_id": confirmation_msg_id}

    except MaxRetriesExceededError:
        logger.critical(f"Failed to send contact+confirmation emails from {user_email} after multiple retries.")
        return {"status": "failed", "reason": "Max retries exceeded"}

    except AzureError as e:
        log_exception(logger, "Azure error while sending contact+confirmation emails", e)
        raise self.retry(exc=e, countdown=10)

    except Exception as e:
        log_exception(logger, "Unexpected error while sending contact+confirmation emails", e)
        raise self.retry(exc=e, countdown=10)


