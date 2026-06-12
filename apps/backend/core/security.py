from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, Response, status, WebSocketException, Query
from fastapi.security import OAuth2PasswordBearer
from bson import ObjectId 

# Assuming models.py is in the same directory or accessible via PYTHONPATH
from models.domain import TokenData, UserInDB # UserInDB now has 'system_role' from User model (defaulting to "user")
from core.config import Settings
from typing import Optional, List, Any # Added List, Any
import logging
import secrets
import uuid
from utils.secure_logger import log_exception, log_warning

try:
    from core.database import users_collection
    if users_collection is not None:
        logging.info("AUTH.PY: users_collection imported successfully from database.py.")
    else:
        logging.error("AUTH.PY: Imported users_collection from database.py, but it is None.")
except ImportError as e:
    logging.critical(f"AUTH.PY: CRITICAL - Failed to import from database.py: {e}. Auth will fail.")
    users_collection = None
# --- END OF CHANGE ---


logger = logging.getLogger(__name__)
from core.config import settings  # SECURITY: Import singleton — do not create another Settings() instance here

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

AUTH_COOKIE_NAME = "contractsense_access"
AUTH_COOKIE_SENTINEL = "cookie"
CSRF_COOKIE_NAME = "contractsense_csrf"
CSRF_HEADER_NAME = "x-csrf-token"
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# SECURITY: JWT revocation is backed by MongoDB (revoked_tokens collection with TTL index).
# This works correctly across multiple workers/processes unlike an in-memory set.
# The TTL index on `expires_at` auto-cleans expired entries — no cron job needed.
# Index is created in database_indexes.py via initialize_all_indexes().
import threading
_revocation_lock = threading.Lock()

def _revoked_tokens_collection():
    """Lazy accessor for the revoked_tokens MongoDB collection."""
    try:
        from core.database import db as _db
        return _db["revoked_tokens"]
    except Exception:
        return None


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_user(username: str) -> Optional[UserInDB]:
    if users_collection is None:
        logger.error("get_user: users_collection is not initialized.")
        return None
    
    logger.info(f"get_user is querying database: '{users_collection.database.name}' on host {users_collection.database.client.HOST}")
    
        
    user_data_from_db = users_collection.find_one({"$or": [{"username": username}, {"email": username}]})
    if user_data_from_db:
        logger.info(f"User '{username}' FOUND in database.")
        try:
            if "_id" not in user_data_from_db or not isinstance(user_data_from_db["_id"], ObjectId):
                logger.error(f"User data for {username} missing or has invalid _id field: {user_data_from_db.get('_id')}")
                return None

            # --- EXPLICITLY CONVERT _id TO STRING FOR THE 'id' FIELD ---
            # Pydantic's populate_by_name with alias will map this modified "_id" (now a string)
            # to the 'id: str' field in UserInDB.
            # Alternatively, you could create a new dict:
            # validated_data = user_data_from_db.copy()
            # validated_data["_id"] = str(validated_data["_id"])
            # And then pass validated_data to model_validate.
            # For simplicity, modifying in place before validation if it's a fresh dict from DB.
            
            # The ObjectIdStr type helper is for fields explicitly typed as ObjectIdStr.
            # For the aliased 'id: str' field, we need to ensure the source data for '_id'
            # is already a string when Pydantic tries to populate 'id'.

            # No, this manual conversion for _id directly is not how alias + type should work with BeforeValidator
            # Let's rely on the model definition and ensure UserInDB is structured correctly.

            # Re-check models.py: UserInDB inherits id: str = Field(alias="_id") from User.
            # The issue might be that `id` is `str` but the alias `_id` is still `ObjectId` when Pydantic gets it.
            # Pydantic v2's `BeforeValidator` on `ObjectIdStr` should apply if the field *target type* is `ObjectIdStr`.
            # Since `id` is `str`, it doesn't automatically use `ObjectIdStr`'s validator.

            # The most straightforward way if `id: str = Field(alias="_id")` is to pre-convert:
            data_for_pydantic = user_data_from_db.copy() # Make a copy to avoid modifying the original dict from DB
            if isinstance(data_for_pydantic.get("_id"), ObjectId):
                data_for_pydantic["_id"] = str(data_for_pydantic["_id"])
            
            # Ensure teamIds is a list, even if None from DB (Pydantic handles default_factory)
            if "teamIds" not in data_for_pydantic or data_for_pydantic["teamIds"] is None:
                data_for_pydantic["teamIds"] = []
            
            # Ensure system_role default if missing
            if "system_role" not in data_for_pydantic:
                data_for_pydantic["system_role"] = "user"


            return UserInDB.model_validate(data_for_pydantic) # Use model_validate for Pydantic v2

        except Exception as e_pydantic: # Catch Pydantic validation errors or other errors
            log_exception(logger, f"User data processing error in get_user for {username}", e_pydantic)
            return None
    else:
        logger.warning(f"User '{username}' not found in database during get_user.")
    return None


    pass

def authenticate_user(username: str, password: str) -> Optional[UserInDB]:
    user = get_user(username)
    if not user:
        return None

    password_verified = verify_password(password, user.hashed_password)
    
    if not password_verified:
        return None
    
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire_minutes = settings.access_token_expire_minutes if hasattr(settings, 'access_token_expire_minutes') else 30
        expire = datetime.utcnow() + timedelta(minutes=expire_minutes)
    # SECURITY: Add jti (JWT ID) claim to enable per-token revocation via blocklist
    to_encode.update({"exp": expire, "jti": str(uuid.uuid4())})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt

def _cookie_security_attrs() -> dict[str, Any]:
    return {
        "secure": settings.is_production,
        "samesite": "none" if settings.is_production else "lax",
        "path": "/",
    }


def _allowed_csrf_origins() -> set[str]:
    raw_origins = settings.allowed_origins
    if isinstance(raw_origins, str):
        origins = {origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()}
    else:
        origins = {str(origin).strip().rstrip("/") for origin in raw_origins if str(origin).strip()}
    domain = str(getattr(settings, "domain", "") or "").strip().rstrip("/")
    if domain:
        origins.add(domain)
    return origins


def _origin_from_url(value: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def _validate_cookie_csrf(request: Request) -> None:
    if request.method.upper() not in _UNSAFE_METHODS:
        return

    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
    csrf_header = request.headers.get(CSRF_HEADER_NAME)
    if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed.")

    allowed_origins = _allowed_csrf_origins()
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    request_origin = origin.rstrip("/") if origin else _origin_from_url(referer or "")
    if request_origin and request_origin not in allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed.")

    return


def set_auth_cookies(response: Response, access_token: str) -> str:
    attrs = _cookie_security_attrs()
    max_age = max(60, int(settings.access_token_expire_minutes) * 60)
    response.set_cookie(
        AUTH_COOKIE_NAME,
        access_token,
        httponly=True,
        max_age=max_age,
        **attrs,
    )
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        httponly=False,
        max_age=max_age,
        **attrs,
    )
    return csrf_token


def clear_auth_cookies(response: Response) -> None:
    attrs = _cookie_security_attrs()
    response.delete_cookie(AUTH_COOKIE_NAME, **attrs)
    response.delete_cookie(CSRF_COOKIE_NAME, **attrs)


def revoke_access_token(token: Optional[str]) -> None:
    """Store the token's JTI in MongoDB so revocation is visible across all workers."""
    if not token:
        return
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti:
        return
    try:
        col = _revoked_tokens_collection()
        if col is None:
            logger.error("revoke_access_token: revoked_tokens collection unavailable")
            return
        from datetime import timezone
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else datetime.utcnow() + timedelta(hours=24)
        col.update_one(
            {"jti": str(jti)},
            {"$setOnInsert": {"jti": str(jti), "expires_at": expires_at}},
            upsert=True,
        )
    except Exception as e:
        logger.error(f"revoke_access_token: failed to persist revocation: {e}")


def get_current_user(request: Request, token: Optional[str] = Depends(oauth2_scheme)) -> UserInDB:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if users_collection is None:
        logger.error("get_current_user: users_collection is not initialized.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Authentication service temporarily unavailable.")

    username: Optional[str] = None
    cookie_auth = False
    resolved_token = token
    if not resolved_token or resolved_token == AUTH_COOKIE_SENTINEL:
        resolved_token = request.cookies.get(AUTH_COOKIE_NAME)
        cookie_auth = bool(resolved_token)
    if not resolved_token:
        raise credentials_exception

    if cookie_auth:
        _validate_cookie_csrf(request)

    try:
        payload = jwt.decode(resolved_token, settings.secret_key, algorithms=[settings.algorithm])
        jti = payload.get("jti")
        if jti:
            try:
                col = _revoked_tokens_collection()
                if col is not None and col.find_one({"jti": str(jti)}):
                    raise credentials_exception
            except HTTPException:
                raise
            except Exception as rev_err:
                logger.warning(f"Could not check token revocation store: {rev_err}")
        username = payload.get("sub")
            
        if username is None:
            logger.warning("Username (sub) not found in JWT payload.")
            credentials_exception.detail = "Invalid token: Subject missing."
            raise credentials_exception
    except JWTError as e:
        # SECURITY: Log full detail server-side, but NEVER send JWT library error strings to the caller
        # Doing so reveals algorithm details, expiry info, and signature structure to attackers.
        logger.warning(f"JWT validation error on request: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_from_db = get_user(username)
    
    if user_from_db is None:
        logger.warning(f"User (from token) not found or failed validation during get_user.")
        # SECURITY: Do not expose whether the username existed or not
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_from_db

def get_current_active_user(current_user: UserInDB = Depends(get_current_user)) -> UserInDB:
    if current_user.disabled:
        logger.warning(f"Attempt to use disabled user account: {current_user.username}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user account.")
    return current_user

# get_db — yields the app-level Motor async DB (no per-request client creation).
async def get_db():
    """Dependency that yields the shared async Motor database instance."""
    from core.database import async_db
    yield async_db
