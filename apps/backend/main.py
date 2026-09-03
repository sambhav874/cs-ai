from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware as _CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from dotenv import load_dotenv
from core.config import Settings
import logging
from api.routes.beta import beta_router

# Import other routers and dependencies
from api.routes.auth import auth_router
from api.routes.contracts import contracts_router
from api.routes.kpis import kpis_router
from api.routes.workflows import workflows_router
from api.routes.teams import team_sub_router
from api.routes.audit import audit_router as audit_logger_sub_router
from celery_app import celery_app 
from api.routes.websocket import status_router 
from api.routes.support import support_sub_router
from api.routes.tasks import router as task_router
from api.routes.edits import router as edit_router
from api.routes.projects import router as projects_router
from api.routes.tabular_reviews import router as tabular_reviews_router
from api.routes.playbooks import router as playbooks_router
from api.routes.agent import router as agent_router
from api.routes.evaluations import router as evaluations_router
from api.routes.model_settings import router as model_settings_router
from api.routes.preferences import router as preferences_router
from api.routes.review_queue import review_queue_router
from api.routes.personas import personas_router
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from core.rate_limiter import limiter
from utils.secure_logger import log_exception

# Configure logger for this module
logger = logging.getLogger(__name__)

# --- Import collections from core.database ---
try:
    from core.database import (
        audit_logs_collection as centrally_defined_audit_collection,
        teams_collection as centrally_defined_teams_collection,
        accounts_collection as centrally_defined_accounts_collection,
        users_collection as centrally_defined_users_collection,
    )
    logger.debug(f"SERVICE.PY: Imported 'centrally_defined_audit_collection': {type(centrally_defined_audit_collection)}")
    logger.debug(f"SERVICE.PY: Imported 'centrally_defined_teams_collection': {type(centrally_defined_teams_collection)}")
    logger.debug(f"SERVICE.PY: Imported 'centrally_defined_accounts_collection': {type(centrally_defined_accounts_collection)}")
    logger.debug(f"SERVICE.PY: Imported 'centrally_defined_users_collection': {type(centrally_defined_users_collection)}")
except ImportError as e:
    logger.error(f"SERVICE.PY: CRITICAL - Failed to import one or more collections from core.database: {e}")
    centrally_defined_audit_collection = None
    centrally_defined_teams_collection = None    
    centrally_defined_accounts_collection = None 
    centrally_defined_users_collection = None
# --- End Import collections ---

load_dotenv()
settings = Settings()

# SECURITY: Do not print environment configuration to stdout. Use structured logging at debug level.
logger.debug(f"Server starting. TESTING flag: {settings.testing}")

is_prod = settings.is_production
app = FastAPI(
    title="Contract Analysis API",
    description="API for contract analysis and processing",
    version="1.0.0",
    docs_url=None if is_prod else "/api/docs",
    redoc_url=None if is_prod else "/api/redoc",
    openapi_url=None if is_prod else "/api/openapi.json"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # SECURITY: Scope Cache-Control: no-store to API routes only.
        # Static/public assets should be cacheable; aggressive no-store on all
        # responses breaks CDN and browser caching for non-sensitive content.
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        # SECURITY: Content-Security-Policy — prevents XSS exploitation.
        # 'unsafe-inline' for style-src is required for CSS-in-JS (Tailwind, etc.).
        # Tighten further (nonce-based) if/when the frontend is server-rendered.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: blob:; "
            "connect-src 'self'; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none';"
        )
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        if "server" in response.headers:
            del response.headers["server"]
        return response

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# --- Attach collections to app.state ---
if centrally_defined_audit_collection is not None:
    app.state.audit_logs_collection = centrally_defined_audit_collection
    logger.info("SERVICE.PY: Audit logs collection attached to app.state.")
else:
    logger.error("SERVICE.PY: CRITICAL - audit_logs_collection is None. Cannot attach to app.state.")
    app.state.audit_logs_collection = None

if centrally_defined_teams_collection is not None:
    app.state.teams_collection = centrally_defined_teams_collection
    logger.info("SERVICE.PY: Teams collection attached to app.state.")
else:
    logger.error("SERVICE.PY: CRITICAL - teams_collection is None. Cannot attach to app.state.")
    app.state.teams_collection = None

if centrally_defined_accounts_collection is not None:
    app.state.accounts_collection = centrally_defined_accounts_collection
    logger.info("SERVICE.PY: Accounts collection attached to app.state.")
else:
    logger.error("SERVICE.PY: CRITICAL - accounts_collection is None. Cannot attach to app.state.")
    app.state.accounts_collection = None

if centrally_defined_users_collection is not None:
    app.state.users_collection = centrally_defined_users_collection
    logger.info("SERVICE.PY: Users collection attached to app.state.")
else:
    logger.error("SERVICE.PY: CRITICAL - users_collection is None. Cannot attach to app.state.")
    app.state.users_collection = None
# --- End Attach collections to app.state ---

# ── CORS Middleware (WebSocket-aware) ────────────────────────────────────────
# Starlette's stock CORSMiddleware rejects WS upgrade requests whose Origin
# header doesn't match — even when the endpoint handles auth via JWT.
# This subclass skips CORS checks for WebSocket connections entirely; auth is
# enforced inside the endpoint.
class CORSMiddleware(_CORSMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            headers = dict(scope.get("headers", []))
            origin = headers.get(b"origin", b"").decode("utf-8")
            allowed = []
            if isinstance(settings.allowed_origins, str):
                allowed = [o.strip() for o in settings.allowed_origins.split(",")]
            else:
                allowed = list(settings.allowed_origins)
                
            if origin and origin not in allowed:
                logger.warning(f"WebSocket connection rejected from unauthorized origin: {origin}")
                await send({"type": "websocket.close", "code": 4403})
                return
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# CORS middleware configuration
origins = []
raw_origins = []
if isinstance(settings.allowed_origins, str):
    raw_origins = [origin.strip() for origin in settings.allowed_origins.split(',')]
else:
    raw_origins = list(settings.allowed_origins)
origins = raw_origins

logger.info(f"CORS: Final allowed origins: {origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "X-CSRF-Token"],
    max_age=86400,
)

# Main API router
v1_router = APIRouter(prefix="/api/v1")

# Include all sub-routers
v1_router.include_router(auth_router, tags=["Authentication & User Management"])
v1_router.include_router(contracts_router, tags=["Contract Analysis"])
v1_router.include_router(kpis_router, tags=["KPIs"])
v1_router.include_router(workflows_router, tags=["Workflow Actions"])
v1_router.include_router(team_sub_router, tags=["Teams & Accounts"])   
v1_router.include_router(audit_logger_sub_router, tags=["Audit Logs & Analytics"]) 
v1_router.include_router(status_router, tags=["Job Status & WebSockets"]) 
v1_router.include_router(beta_router, tags=["Beta Features"])
v1_router.include_router(support_sub_router, tags=["Support"])
v1_router.include_router(task_router, tags=["Tasks"])  
v1_router.include_router(edit_router, tags=["Edit Utils"])
v1_router.include_router(projects_router, tags=["Projects"])
v1_router.include_router(tabular_reviews_router, tags=["Tabular Reviews"])
v1_router.include_router(playbooks_router, tags=["Playbooks"])
v1_router.include_router(agent_router, tags=["ContractSense Agent"])
v1_router.include_router(evaluations_router, tags=["Evaluations"])
v1_router.include_router(model_settings_router, tags=["Model Settings"])
v1_router.include_router(preferences_router, tags=["User Preferences"])
v1_router.include_router(review_queue_router, tags=["Review Queue"])
v1_router.include_router(personas_router, tags=["Personas & Privileges"])

if settings.testing:
    from test_support.testing_utils import testing_router
    v1_router.include_router(testing_router, tags=["Testing"])
    logger.info("<<<<< SUCCESS: TESTING ROUTER HAS BEEN INCLUDED >>>>>")

app.include_router(v1_router)

@app.on_event("startup")
async def startup_event():
    # Register PII Sanitizing filter on all active root handlers
    try:
        from utils.secure_logger import PIISanitizingFilter
        root_logger = logging.getLogger()
        pii_filter = PIISanitizingFilter()
        root_logger.addFilter(pii_filter)
        for handler in root_logger.handlers:
            handler.addFilter(pii_filter)
        logger.info("PIISanitizingFilter registered on root logger and handlers.")
    except Exception as log_filter_err:
        logger.warning(f"Failed to register PIISanitizingFilter: {log_filter_err}")

    try:
        from core.database import db as mongo_db
        from core.database_indexes import initialize_all_indexes

        initialize_all_indexes(mongo_db)
    except Exception as e:
        log_exception(logger, "Failed to initialize database indexes", e)

    # Initialize Celery app (now using Azure Blob Storage backend)
    try:
        # An unreachable broker makes this ping hang rather than fail, and the
        # app never finishes starting — the API is down because a queue is,
        # which is not a trade the API should make. Bounded, and skipped
        # entirely for a test/sandbox run that has no worker.
        if celery_app and not settings.testing:
            celery_app.control.ping(timeout=2.0)
            logger.info("Celery app initialized and broker is responsive.")
            
            # You might want to verify blob storage connectivity here if needed
            logger.info(f"Celery result backend configured for: {celery_app.conf.result_backend}")
    except Exception as e:
        log_exception(logger, "Failed to initialize or connect to Celery broker", e)
        # Depending on requirements, you might want to raise the exception
        # to prevent the application from starting in a broken state.
        # raise
    
    logger.info("FastAPI application startup complete.")

@app.on_event("startup")
async def validate_security_config():
    """Fail-fast on dangerous security misconfigurations at startup."""
    # SECURITY: Wildcard CORS origin with allow_credentials=True is rejected by browsers
    # but still processed server-side — block it at startup to prevent misconfiguration.
    raw = []
    if isinstance(settings.allowed_origins, str):
        raw = [o.strip() for o in settings.allowed_origins.split(',')]
    else:
        raw = list(settings.allowed_origins)
    if "*" in raw:
        raise RuntimeError(
            "SECURITY MISCONFIGURATION: Wildcard CORS origin ('*') cannot be used with "
            "allow_credentials=True. Set ALLOWED_ORIGINS to explicit domain(s)."
        )
    # SECURITY: If APP_ENV is not 'development' but enable_ssl is False or cookies
    # would be set without Secure=True, warn loudly. This catches misconfigured
    # staging/prod servers where APP_ENV was accidentally left as 'development'.
    if not settings.is_production and settings.app_env not in ("development", "dev", "test", "testing"):
        logger.warning(
            f"SECURITY WARNING: APP_ENV is '{settings.app_env}' (not 'production'), "
            "so auth cookies will be sent without Secure flag. "
            "Set APP_ENV=production on staging/prod servers."
        )
    logger.info("Security configuration validated at startup.")

@app.get("/")
async def root():
    # SECURITY: Do not expose internal API paths or documentation URLs in the root response
    return {"status": "ok"}

@app.get("/health")
async def health_check():
    # Basic health check
    return {
        "status": "healthy"
    }

if __name__ == "__main__":
    import uvicorn
    api_port_to_use = settings.api_port if isinstance(settings.api_port, int) else 8000
    uvicorn.run(
        "main:app", 
        host=settings.api_host, 
        port=api_port_to_use, 
        reload=not settings.is_production,
        workers=4 if settings.is_production else 1,
        access_log=True
    )
