"""Application configuration"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """App settings from env vars"""
    # API
    API_PREFIX: str = "/api"
    
    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "https://*.vercel.app"]
    
    # AWS
    AWS_REGION: str = "us-east-1"
    S3_BUCKET: str = "amazon-audit-uploads"
    COGNITO_USER_POOL_ID: str = ""
    COGNITO_CLIENT_ID: str = ""
    
    # Database (RDS PostgreSQL)
    DATABASE_URL: str = ""

    # Perplexity Sonar (real-time benchmarks)
    PERPLEXITY_API_KEY: str = ""
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
