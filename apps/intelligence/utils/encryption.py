import base64
import hashlib
from cryptography.fernet import Fernet
from core.config import settings

# Derive a Fernet key from settings.secret_key using SHA-256
key_bytes = hashlib.sha256(settings.secret_key.encode('utf-8')).digest()
fernet_key = base64.urlsafe_b64encode(key_bytes)
fernet = Fernet(fernet_key)

def encrypt_value(val: str) -> str:
    """Encrypt a string value using Fernet."""
    if not val:
        return val
    return fernet.encrypt(val.encode('utf-8')).decode('utf-8')

def decrypt_value(val: str) -> str:
    """
    Decrypt a string value using Fernet.
    Fallback: returns the original value if it doesn't appear to be encrypted
    (e.g., legacy unencrypted credentials).
    """
    if not val:
        return val
    try:
        return fernet.decrypt(val.encode('utf-8')).decode('utf-8')
    except Exception:
        # Fallback to plain text for unencrypted values
        return val
