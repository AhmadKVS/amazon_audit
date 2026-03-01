"""
AWS Cognito Auth - Sign up, login, JWT tokens
Week 1: AUD-3
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class SignUpRequest(BaseModel):
    email: str
    password: str


class SignInRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int


@router.post("/signup")
async def sign_up(req: SignUpRequest):
    """Register new user via Cognito"""
    # TODO: Integrate with AWS Cognito when credentials configured
    return {"message": "Sign up endpoint - configure COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID"}


@router.post("/signin", response_model=AuthResponse)
async def sign_in(req: SignInRequest):
    """Authenticate user and return JWT tokens"""
    # TODO: Integrate with AWS Cognito
    raise HTTPException(501, "Auth not configured - set up Cognito User Pool")


@router.post("/refresh")
async def refresh_token(refresh_token: str):
    """Refresh access token"""
    # TODO: Cognito token refresh
    raise HTTPException(501, "Refresh not configured")
