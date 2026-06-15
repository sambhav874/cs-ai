import os
import ssl
import logging
from celery import Celery
from celery.signals import worker_process_init, after_setup_logger, after_setup_task_logger
from kombu import Queue, Exchange
from dotenv import load_dotenv
from core.config import Settings
from utils.secure_logger import log_exception

# =============================================================================
# Logging & Environment Setup
# =============================================================================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()
settings = Settings()

# Patch Celery 5.5.x task-success logging (TypeError: format requires a mapping).
# Celery's trace.info() passes a namedtuple as 'context' to logger.info(),
# but the LOG_SUCCESS format string uses %(name)s dict-style placeholders
# that require a real dict.  This breaks the logging call and, because
# fast_trace_task swallows the TypeError, the frontend never sees the
# task-completed signal through the real-time websocket pipeline.
import celery.app.trace as _celery_trace  # noqa: E402
import collections.abc  # noqa: E402


_original_info = _celery_trace.info


def _safe_info(fmt, context):
    if not isinstance(context, collections.abc.Mapping):
        try:
            context = context._asdict() if hasattr(context, "_asdict") else vars(context)
        except Exception:
            context = {}
    _original_info(fmt, context)


_celery_trace.info = _safe_info  # type: ignore[assignment]

# =============================================================================
# Dynamic Broker & Backend Configuration
# =============================================================================
# 1. Message Broker Configuration
# Primary Default: RabbitMQ 
# Fallback: Azure Service Bus (Activated via USE_AZURE_SERVICE_BUS=true)
celery_broker = os.getenv("CELERY_BROKER_URL")

if celery_broker:
    broker_url = celery_broker
elif os.getenv("USE_AZURE_SERVICE_BUS", "false").lower() == "true" and os.getenv("SERVICE_BUS_NAMESPACE"):
    sas_policy_name = os.getenv("SERVICE_BUS_SAS_POLICY_NAME")
    sas_key = os.getenv("SERVICE_BUS_SAS_KEY")
    namespace = os.getenv("SERVICE_BUS_NAMESPACE")
    broker_url = f"azureservicebus://{sas_policy_name}:{sas_key}@{namespace}.servicebus.windows.net"
else:
    raise RuntimeError(
        "SECURITY: CELERY_BROKER_URL must be explicitly set. "
        "No default broker credentials are permitted. "
        "Set USE_AZURE_SERVICE_BUS=true or provide CELERY_BROKER_URL."
    )

# 2. Result Backend Configuration
# Primary Default: RPC (Stores results back in RabbitMQ - no extra infra needed)
# Fallback: Azure Blob Storage (Activated via USE_AZURE_BLOB_STORAGE=true)
celery_backend = os.getenv("CELERY_RESULT_BACKEND")
container_name = 'celery-results'

if celery_backend:
    backend_url = celery_backend
elif os.getenv("USE_AZURE_BLOB_STORAGE", "false").lower() == "true" and os.getenv("AZURE_STORAGE_CONNECTION_STRING"):
    backend_url = f"azureblockblob://{os.getenv('AZURE_STORAGE_CONNECTION_STRING')}"
else:
    backend_url = "rpc://"

# =============================================================================
# Celery Application Initialization
# =============================================================================
try:
    celery_app = Celery(
        'contract_processor',
        broker_url=broker_url,
        backend=backend_url,
        include=['worker.tasks'],
        broker_connection_retry_on_startup=True,
    )
    logger.info("Celery app initialized successfully")
except Exception as e:
    log_exception(logger, "Failed to initialize Celery app", e)
    raise 

# =============================================================================
# Celery Core Configuration
# =============================================================================
celery_app.conf.update(
    # General Task Settings
    task_acks_late=True,
    broker_transport_options={'visibility_timeout': 3600},
    worker_prefetch_multiplier=1,
    
    # Task Routing (Mapping tasks to specific queues)
    task_routes={
        'index_contract_task': {'queue': 'indexing'},
        'send_beta_welcome_email_task': {'queue': 'default'},
        'tasks.send_kpi_alert_email': {'queue': 'default'},
        'fetch_kpi_source_task': {'queue': 'kpi_ingestion'},
        'run_due_kpi_source_fetches': {'queue': 'kpi_ingestion'},
    },
    
    # Serialization & Timestamps
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='UTC',
    enable_utc=True,
    
    # Worker Pool Settings
    worker_max_tasks_per_child=100,
    worker_pool='threads',
    task_reject_on_worker_lost=True,
    
    # Queue Definitions
    task_default_queue='default',
    task_queues=(
        Queue('default', Exchange('default'), routing_key='default'),
        Queue('indexing', Exchange('indexing'), routing_key='indexing'),
        Queue('kpi_ingestion', Exchange('kpi_ingestion'), routing_key='kpi_ingestion'),
    ),

    beat_schedule={
        'run-due-kpi-source-fetches-every-5-minutes': {
            'task': 'run_due_kpi_source_fetches',
            'schedule': 300.0,
        },
    },
    
    # Task Execution Limits
    task_track_started=True,
    task_time_limit=7200,       # Hard limit (2 hours)
    task_soft_time_limit=5400,  # Soft limit (1.5 hours)
    
    # Connection Retrieval
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    broker_connection_retry_delay=5,
)

# Inject Azure-specific configs only if Azure Blob Storage is utilized
if backend_url.startswith("azureblockblob"):
    celery_app.conf.update(
        result_backend_transport_options={
            'container_name': container_name,
            'global_keyprefix': 'celery-result-',
        }
    )

# =============================================================================
# Worker Process Initialization
# =============================================================================
@worker_process_init.connect
def configure_workers(sender=None, conf=None, **kwargs):
    """
    Hook to configure worker-specific settings when a Celery worker process spins up.
    This injects necessary API/connection keys from settings into the active environment variables.
    """
    try:
        os.environ['PINECONE_API_KEY'] = settings.pinecone_api_key
        
        # Hydrate Azure Service Bus configuration if available so internal connections succeed
        if hasattr(settings, 'azure_service_bus_connection_string') and settings.azure_service_bus_connection_string:
            os.environ['AZURE_SERVICE_BUS_CONNECTION_STRING'] = settings.azure_service_bus_connection_string
            
        logger.info("Worker process initialized with environment variables")
    except Exception as e:
        log_exception(logger, "Error configuring worker", e)
        raise


@after_setup_logger.connect
def setup_loggers(logger, *args, **kwargs):
    try:
        from utils.secure_logger import PIISanitizingFilter
        pii_filter = PIISanitizingFilter()
        logger.addFilter(pii_filter)
        for handler in logger.handlers:
            handler.addFilter(pii_filter)
    except Exception as exc:
        logging.warning(f"Failed to attach PIISanitizingFilter to celery logger: {exc}")


@after_setup_task_logger.connect
def setup_task_loggers(logger, *args, **kwargs):
    try:
        from utils.secure_logger import PIISanitizingFilter
        pii_filter = PIISanitizingFilter()
        logger.addFilter(pii_filter)
        for handler in logger.handlers:
            handler.addFilter(pii_filter)
    except Exception as exc:
        logging.warning(f"Failed to attach PIISanitizingFilter to celery task logger: {exc}")

# =============================================================================
# Entry Execution (Check)
# =============================================================================
if __name__ == '__main__':
    logger.info("Starting Celery app configuration check")
    # SECURITY: Redact credentials from URL before logging
    broker_host = celery_app.conf.broker_url.split('@')[-1] if '@' in (celery_app.conf.broker_url or '') else '[configured]'
    logger.info(f"Broker URL (host only): {broker_host}")
    logger.info("Result Backend: [configured — value redacted from logs]")
    logger.info("Celery configuration completed successfully")
