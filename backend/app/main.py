"""
Amazon Audit MVP - FastAPI + Mangum Backend
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import upload, health, benchmarks, audit, share, business_report, analyze, admin_auth, admin, store_lookup
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure DynamoDB table exists on startup
    try:
        from app.services.dynamo import ensure_table
        ensure_table()
    except Exception as e:
        print(f"[startup] DynamoDB setup warning: {e}")
    yield


app = FastAPI(
    title="Amazon Audit API",
    description="API for Amazon seller audit and analytics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(upload.router, prefix="/api/upload", tags=["Upload"])
app.include_router(benchmarks.router, prefix="/api/benchmarks", tags=["Benchmarks"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(share.router, prefix="/api", tags=["Share"])
app.include_router(business_report.router, prefix="/api/business-report", tags=["Business Report"])
app.include_router(analyze.router, prefix="/api/analyze", tags=["Analyze"])
app.include_router(admin_auth.router, prefix="/api/admin", tags=["Admin Auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(store_lookup.router, prefix="/api", tags=["Store Lookup"])


def handler(event, context):
    """Lambda handler using Mangum"""
    from mangum import Mangum
    return Mangum(app, lifespan="off")(event, context)
