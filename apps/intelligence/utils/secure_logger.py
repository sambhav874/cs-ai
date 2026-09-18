"""
secure_logger.py — Environment-aware exception logging utility.

SECURITY POLICY (ISO 27001 A.8.15 / NIST AU-3):
  - In DEVELOPMENT: full exception details, stack traces, and exc_info are logged.
  - In PRODUCTION / STAGING: only a safe, opaque error message is logged.
    No exception strings, no stack traces, no internal paths, no variable values.

Usage:
    from utils.secure_logger import log_exception

    try:
        do_something()
    except Exception as e:
        log_exception(logger, "Operation X failed", e)
        raise HTTPException(500, "An internal error occurred.")

The caller is still responsible for returning a GENERIC error message to the client.
This utility only controls what is recorded in server-side logs.
"""

import logging
import os
import re

# Determine environment once at module load time.
# Reads APP_ENV from the environment (matches Settings.app_env).
_APP_ENV = os.getenv("APP_ENV", "development").lower()
_IS_DEV = _APP_ENV in ("development", "dev", "local")


def log_exception(
    logger: logging.Logger,
    message: str,
    exc: Exception,
    level: int = logging.ERROR,
) -> None:
    """
    Log an exception in an environment-appropriate way.

    Dev  → full message + exception type + exc_info (stack trace).
    Prod → safe message only, no exception string, no stack trace.

    Args:
        logger:  The logger instance for the calling module.
        message: A developer-facing description of the failure context.
        exc:     The caught exception to conditionally include.
        level:   Logging level (default: ERROR). Use logging.WARNING for non-critical.
    """
    if _IS_DEV:
        # Full detail for local debugging
        logger.log(level, "%s: %s", message, exc, exc_info=True)
    else:
        # PRODUCTION: log only the context message — no internal data, no stack trace.
        # Sentry / Azure Monitor can capture full traces via their SDK integrations
        # without exposing them to log streams accessible to support/ops teams.
        logger.log(level, "%s (details suppressed in production)", message)


def log_warning(
    logger: logging.Logger,
    message: str,
    exc: Exception,
) -> None:
    """Convenience wrapper for WARNING-level exception logging."""
    log_exception(logger, message, exc, level=logging.WARNING)


def is_dev() -> bool:
    """Returns True when running in a development/local environment."""
    return _IS_DEV


EMAIL_REGEX = re.compile(
    r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b'
)

def sanitize_email(match: re.Match) -> str:
    email = match.group(0)
    parts = email.split('@', 1)
    if len(parts) == 2:
        name, domain = parts
        if len(name) > 1:
            redacted_name = name[0] + "***"
        else:
            redacted_name = "*"
        return f"{redacted_name}@{domain}"
    return email

class PIISanitizingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # 1. Sanitize message string
        if isinstance(record.msg, str):
            record.msg = EMAIL_REGEX.sub(sanitize_email, record.msg)
        
        # 2. Sanitize formatting arguments if they are strings
        if record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    new_args.append(EMAIL_REGEX.sub(sanitize_email, arg))
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)
            
        return True

