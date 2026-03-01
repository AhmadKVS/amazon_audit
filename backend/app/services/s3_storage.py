"""
AWS S3 File Storage - Store uploaded CSVs securely
Week 1: AUD-2
"""
from datetime import datetime
from typing import Optional

from app.core.config import settings


async def upload_to_s3(
    contents: bytes,
    filename: str,
    report_type: str,
    user_id: Optional[str] = None,
) -> Optional[str]:
    """
    Upload CSV to S3. Returns S3 key or None if bucket not configured.
    """
    if not settings.S3_BUCKET or settings.S3_BUCKET == "amazon-audit-uploads":
        # Default bucket name - S3 not yet deployed
        return None

    try:
        import boto3
        s3 = boto3.client("s3", region_name=settings.AWS_REGION)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        prefix = f"uploads/{report_type}"
        if user_id:
            prefix = f"uploads/{user_id}/{report_type}"
        key = f"{prefix}/{timestamp}_{filename}"

        s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=contents,
            ContentType="text/csv",
        )
        return key
    except Exception:
        return None
