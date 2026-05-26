import os
import time
import jwt
import requests
from functools import wraps
from flask import request, jsonify

TENANT_ID = os.environ.get("AZURE_TENANT_ID")
CLIENT_ID = os.environ.get("AZURE_CLIENT_ID")

JWKS_URL = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
ISSUER = f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"

# Cache JWKS keys
_jwks_cache = {"keys": None, "fetched_at": 0}
JWKS_CACHE_DURATION = 86400  # 24 hours


def _get_signing_keys():
    """Fetch and cache JWKS from Microsoft's endpoint."""
    now = time.time()
    if _jwks_cache["keys"] and (now - _jwks_cache["fetched_at"]) < JWKS_CACHE_DURATION:
        return _jwks_cache["keys"]

    resp = requests.get(JWKS_URL, timeout=10)
    resp.raise_for_status()
    _jwks_cache["keys"] = resp.json()["keys"]
    _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


def _get_public_key(token):
    """Find the correct public key for the token's kid header."""
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    keys = _get_signing_keys()

    for key in keys:
        if key["kid"] == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)

    # Key not found — refresh cache once and retry
    _jwks_cache["keys"] = None
    keys = _get_signing_keys()
    for key in keys:
        if key["kid"] == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)

    raise ValueError(f"Unable to find signing key with kid: {kid}")


def validate_token(auth_header):
    """
    Validate the Bearer token from the Authorization header.
    Returns decoded claims on success, raises Exception on failure.
    """
    if not auth_header or not auth_header.startswith("Bearer "):
        raise ValueError("Missing or invalid Authorization header")

    token = auth_header.split(" ", 1)[1]
    public_key = _get_public_key(token)

    claims = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=CLIENT_ID,
        issuer=ISSUER,
        options={"require": ["exp", "iss", "aud"]},
    )
    return claims


def require_auth(f):
    """Flask decorator to enforce JWT authentication on a route."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            claims = validate_token(request.headers.get("Authorization"))
            request.user_claims = claims
            request.user_id = claims.get("oid", claims.get("sub", "anonymous"))
        except Exception as e:
            return jsonify({"error": "Unauthorized", "detail": str(e)}), 401
        return f(*args, **kwargs)
    return decorated
