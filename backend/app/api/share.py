"""
Share API — generate public share tokens for audit reports.
  POST /api/audit/{audit_id}/share  (authenticated) → creates token, returns share URL
  GET  /api/share/{token}           (public)         → returns full audit data
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.dependencies import get_current_user
from app.services.dynamo import set_share_token, get_audit_by_token

router = APIRouter()


@router.post("/audit/{audit_id}/share")
async def create_share_link(
    audit_id: str,
    request: Request,
    user: str = Depends(get_current_user),
):
    """Generate a shareable public link for an audit report."""
    token = uuid.uuid4().hex  # 32-char hex token

    try:
        set_share_token(user_id=user, audit_id=audit_id, token=token)
    except Exception as e:
        raise HTTPException(500, f"Failed to create share link: {e}")

    base_url = str(request.base_url).rstrip("/")
    share_url = f"{base_url.replace(':8000', ':3000')}/share/{token}"

    return {"share_url": share_url, "token": token}


@router.get("/share/{token}")
async def get_shared_audit(token: str):
    """Public endpoint — returns full audit data for a share token (no auth required)."""
    try:
        audit = get_audit_by_token(token)
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch shared audit: {e}")

    if not audit:
        raise HTTPException(404, "Share link not found or expired")

    return audit
