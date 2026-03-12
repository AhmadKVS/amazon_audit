"""
Admin authentication — re-exports from admin.py for import compatibility.
The login endpoint and get_admin_user dependency live in admin.py.
main.py registers admin_auth.router (empty) and admin.router (has all routes).
"""
from fastapi import APIRouter

from app.api.admin import get_admin_user, AdminLoginRequest  # noqa: F401

router = APIRouter()
