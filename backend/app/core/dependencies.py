"""
FastAPI dependencies — JWT auth via AWS Cognito
"""
import boto3
from botocore.exceptions import ClientError
from fastapi import Depends, HTTPException, Header
from functools import lru_cache

from app.core.config import settings


def _cognito():
    return boto3.client(
        "cognito-idp",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


async def get_current_user(authorization: str = Header(default=None)) -> str:
    """
    Verify the Cognito access token from the Authorization header.
    Returns the username (email) of the authenticated user.
    Raises 401 if missing or invalid.
    """
    if not settings.COGNITO_CLIENT_ID:
        # Auth not configured — allow all requests (dev mode)
        return "dev-user"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.removeprefix("Bearer ").strip()

    try:
        user = _cognito().get_user(AccessToken=token)
        return user["Username"]
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NotAuthorizedException", "UserNotFoundException", "TokenExpiredException"):
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired token — please sign in again",
                headers={"WWW-Authenticate": "Bearer"},
            )
        raise HTTPException(status_code=401, detail=f"Auth check failed: {code}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth unavailable: {str(e)}")


# Shorthand for use in route signatures
CurrentUser = Depends(get_current_user)
