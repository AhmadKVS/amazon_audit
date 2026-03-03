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
    content_type: str = "text/csv",
) -> Optional[str]:
    """
    Upload CSV to S3. Returns S3 key or None if bucket not configured.
    """
    if not settings.S3_BUCKET or not settings.AWS_ACCESS_KEY_ID or not settings.AWS_SECRET_ACCESS_KEY:
        print(f"[s3] Skipping upload — bucket={bool(settings.S3_BUCKET)} key={bool(settings.AWS_ACCESS_KEY_ID)} secret={bool(settings.AWS_SECRET_ACCESS_KEY)}")
        return None

    try:
        import boto3
        print(f"[s3] Uploading to bucket={settings.S3_BUCKET} region={settings.AWS_REGION}")
        s3 = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        prefix = f"uploads/{report_type}"
        if user_id:
            prefix = f"uploads/{user_id}/{report_type}"
        key = f"{prefix}/{timestamp}_{filename}"

        s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=contents,
            ContentType=content_type,
        )
        return key
    except Exception as e:
        print(f"[s3] Upload failed: {e}")
        return None
