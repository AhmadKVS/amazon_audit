"""
FastAPI dependencies — user identity via Store URL + IP address.
"""
import hashlib

from fastapi import Depends, Header, HTTPException, Request

from app.services.dynamo import list_audits


def get_client_ip(request: Request) -> str:
    """Extract client IP from X-Forwarded-For (first IP) or request.client."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def normalize_store_url(raw: str) -> str:
    """Normalize an Amazon store URL for consistent hashing."""
    url = raw.strip().lower()
    for prefix in ("https://", "http://"):
        if url.startswith(prefix):
            url = url[len(prefix):]
    if url.startswith("www."):
        url = url[4:]
    return url.rstrip("/")


async def get_current_user(
    request: Request,
    x_store_url: str = Header(default=""),
) -> str:
    """
    Derive a deterministic user_id from the Store URL + client IP.
    Returns a 64-char hex SHA-256 hash.
    """
    ip = get_client_ip(request)
    store = normalize_store_url(x_store_url)
    if store:
        identity = f"{store}|{ip}"
    else:
        identity = f"|{ip}"
    return hashlib.sha256(identity.encode()).hexdigest()


async def check_rate_limit(
    request: Request,
    x_store_url: str = Header(default=""),
) -> None:
    """
    Enforce a maximum of 10 audit analyses per (store_url, IP) identity.
    Only applied to AI-intensive analyze endpoints.
    """
    ip = get_client_ip(request)
    store = normalize_store_url(x_store_url)
    if store:
        identity = f"{store}|{ip}"
    else:
        identity = f"|{ip}"
    user_id = hashlib.sha256(identity.encode()).hexdigest()

    audits = list_audits(user_id)
    if len(audits) >= 10:
        raise HTTPException(
            status_code=429,
            detail="Rate limit reached: maximum 10 audits per store. Contact support for more.",
        )


# Shorthand for use in route signatures
CurrentUser = Depends(get_current_user)
