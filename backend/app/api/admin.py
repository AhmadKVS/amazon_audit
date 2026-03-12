"""
Admin API — JWT-based authentication + CRUD for all audit records.

Login:  POST /api/admin/login
List:   GET  /api/admin/audits
Detail: GET  /api/admin/audits/{user_id}/{audit_id}
Update: PUT  /api/admin/audits/{user_id}/{audit_id}
Delete: DELETE /api/admin/audits/{user_id}/{audit_id}
"""
import hashlib
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from app.core.config import settings
from app.services.dynamo import (
    scan_all_audits,
    get_audit,
    admin_update_audit,
    delete_audit,
)

router = APIRouter()


# ── JWT helpers ───────────────────────────────────────────────────────────────

def _jwt_secret() -> str:
    """Return the JWT signing secret."""
    if settings.ADMIN_JWT_SECRET:
        return settings.ADMIN_JWT_SECRET
    if settings.ADMIN_PASSWORD:
        return hashlib.sha256(settings.ADMIN_PASSWORD.encode()).hexdigest()
    raise HTTPException(500, "Admin auth not configured")


async def get_admin_user(authorization: str = Header(default="")) -> str:
    """Dependency — validates admin JWT from Authorization: Bearer <token>."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing admin token")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
        if payload.get("sub") != "admin":
            raise HTTPException(403, "Not an admin token")
        return payload.get("email", "admin")
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Admin token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid admin token")


# ── Request models ────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminUpdateRequest(BaseModel):
    updates: dict


# ── Auth endpoint ─────────────────────────────────────────────────────────────

@router.post("/login")
async def admin_login(body: AdminLoginRequest):
    """Validate admin credentials and return a signed JWT (24h expiry)."""
    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        raise HTTPException(503, "Admin auth not configured")
    if body.email != settings.ADMIN_EMAIL or body.password != settings.ADMIN_PASSWORD:
        raise HTTPException(401, "Invalid credentials")

    payload = {
        "sub": "admin",
        "email": body.email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm="HS256")
    return {"token": token}


# ── Audit management endpoints ────────────────────────────────────────────────

@router.get("/audits")
async def list_all_audits(
    limit: int = 100,
    cursor: Optional[str] = None,
    _admin: str = Depends(get_admin_user),
):
    """List all audits across all users (paginated)."""
    last_key = json.loads(cursor) if cursor else None
    items, next_key = scan_all_audits(limit=limit, last_key=last_key)
    return {
        "audits": items,
        "next_cursor": json.dumps(next_key) if next_key else None,
    }


@router.get("/audits/{user_id}/{audit_id}")
async def get_audit_detail(
    user_id: str,
    audit_id: str,
    _admin: str = Depends(get_admin_user),
):
    """Get a full audit record by composite key (admin only)."""
    record = get_audit(user_id, audit_id)
    if not record:
        raise HTTPException(404, "Audit not found")
    return record


@router.put("/audits/{user_id}/{audit_id}")
async def update_audit_admin(
    user_id: str,
    audit_id: str,
    body: AdminUpdateRequest,
    _admin: str = Depends(get_admin_user),
):
    """Update fields on an audit (admin only)."""
    forbidden = {"user_id", "audit_id"}
    clean = {k: v for k, v in body.updates.items() if k not in forbidden}
    if not clean:
        raise HTTPException(400, "No valid fields to update")
    admin_update_audit(user_id, audit_id, clean)
    return {"status": "updated", "fields": list(clean.keys())}


@router.delete("/audits/{user_id}/{audit_id}")
async def delete_audit_admin(
    user_id: str,
    audit_id: str,
    _admin: str = Depends(get_admin_user),
):
    """Delete an audit record by composite key (admin only)."""
    existing = get_audit(user_id, audit_id)
    if not existing:
        raise HTTPException(404, "Audit not found")
    delete_audit(user_id, audit_id)
    return {"status": "deleted"}
