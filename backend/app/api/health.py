"""Health check endpoints"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """API health check for load balancer/API Gateway"""
    return {"status": "healthy", "version": "0.1.0"}
