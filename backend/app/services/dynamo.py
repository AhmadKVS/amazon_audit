"""
DynamoDB service — audit report storage.
Table: amazon-audit-reports
  PK: user_id (String)
  SK: audit_id (String)
"""
import json
from decimal import Decimal
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings


def _client():
    return boto3.client(
        "dynamodb",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


def _resource():
    return boto3.resource(
        "dynamodb",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


def ensure_table() -> None:
    """Create the DynamoDB table if it doesn't already exist."""
    table_name = settings.DYNAMODB_TABLE
    client = _client()
    try:
        client.describe_table(TableName=table_name)
        print(f"[dynamo] Table '{table_name}' already exists")
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code != "ResourceNotFoundException":
            print(f"[dynamo] WARNING: cannot check table — {code}: {e.response['Error']['Message']}")
            return
        # ResourceNotFoundException — table doesn't exist yet, create it
        print(f"[dynamo] Creating table '{table_name}'...")
        client.create_table(
            TableName=table_name,
            KeySchema=[
                {"AttributeName": "user_id",  "KeyType": "HASH"},
                {"AttributeName": "audit_id", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "user_id",  "AttributeType": "S"},
                {"AttributeName": "audit_id", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        waiter = client.get_waiter("table_exists")
        waiter.wait(TableName=table_name)
        print(f"[dynamo] Table '{table_name}' ready")
        return


def _sanitize(obj):
    """Remove empty strings from nested dicts/lists (DynamoDB rejects them)."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items() if v != ""}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj


def save_audit(user_id: str, audit_id: str, data: dict) -> None:
    """Persist a full audit record for a user."""
    print(f"[dynamo] save_audit user_id={user_id!r} audit_id={audit_id!r}")
    table = _resource().Table(settings.DYNAMODB_TABLE)
    item = _sanitize({
        "user_id":          user_id,
        "audit_id":         audit_id,
        "created_at":       datetime.now(timezone.utc).isoformat(),
        "brand_name":       data.get("brand_name", ""),
        "niche":            data.get("niche", ""),
        "marketplace":      data.get("marketplace", ""),
        "report_type":      data.get("report_type", ""),
        "audit_purpose":    data.get("audit_purpose", ""),
        "notes":            data.get("notes", ""),
        "brand_analysis":   data.get("brand_analysis", {}),
        "recommendations":  data.get("recommendations", []),
        "benchmark_metrics": data.get("benchmark_metrics", []),
        "csv_metadata":     data.get("csv_metadata", {}),
        "citations":        data.get("citations", []),
        "s3_key":           data.get("s3_key", ""),
    })
    try:
        table.put_item(Item=item)
        print(f"[dynamo] save_audit SUCCESS")
    except Exception as e:
        print(f"[dynamo] save_audit FAILED: {e}")
        raise


def _to_native(obj):
    """Recursively convert DynamoDB Decimal types to int/float for JSON serialisation."""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _to_native(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_native(v) for v in obj]
    return obj


def get_audit(user_id: str, audit_id: str) -> dict | None:
    """Return a single full audit record, or None if not found."""
    table = _resource().Table(settings.DYNAMODB_TABLE)
    item = table.get_item(Key={"user_id": user_id, "audit_id": audit_id}).get("Item")
    if not item:
        return None
    return _to_native(item)


def delete_audit(user_id: str, audit_id: str) -> None:
    """Delete a single audit record by composite key (user_id HASH, audit_id RANGE)."""
    print(f"[dynamo] delete_audit user_id={user_id!r} audit_id={audit_id!r}")
    table = _resource().Table(settings.DYNAMODB_TABLE)
    try:
        table.delete_item(Key={"user_id": user_id, "audit_id": audit_id})
        print(f"[dynamo] delete_audit SUCCESS")
    except Exception as e:
        print(f"[dynamo] delete_audit FAILED: {e}")
        raise


def list_audits(user_id: str) -> list[dict]:
    """Return all audits for a user, sorted newest first (summary fields only)."""
    table = _resource().Table(settings.DYNAMODB_TABLE)
    print(f"[dynamo] list_audits called with user_id={user_id!r}")
    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id),
        ProjectionExpression="audit_id, brand_name, niche, marketplace, report_type, audit_purpose, notes, created_at",
    )
    items = resp.get("Items", [])
    print(f"[dynamo] list_audits -> {len(items)} items found")
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return [_to_native(item) for item in items]


# ── Share tokens ────────────────────────────────────────────────────────────
# Stored as separate items: PK="share", SK=token -> { user_id, audit_id }

def set_share_token(user_id: str, audit_id: str, token: str) -> None:
    """Create a share token item pointing to an audit."""
    table = _resource().Table(settings.DYNAMODB_TABLE)
    table.put_item(Item={
        "user_id":  "share",
        "audit_id": token,
        "owner_id": user_id,
        "real_audit_id": audit_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def find_previous_audit(user_id: str, brand_name: str, report_type: str, current_audit_id: str) -> dict | None:
    """Return the most recent prior audit for the same user, brand, and report type."""
    table = _resource().Table(settings.DYNAMODB_TABLE)
    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id),
        ProjectionExpression="audit_id, brand_name, report_type, created_at, csv_metadata, raw_text",
    )
    items = resp.get("Items", [])
    candidates = [
        item for item in items
        if item.get("brand_name") == brand_name
        and item.get("report_type") == report_type
        and item.get("audit_id") != current_audit_id
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return _to_native(candidates[0])


def get_audit_by_token(token: str) -> dict | None:
    """Look up a full audit record via a share token. Returns None if not found."""
    table = _resource().Table(settings.DYNAMODB_TABLE)

    # Fetch the share pointer
    pointer = table.get_item(Key={"user_id": "share", "audit_id": token}).get("Item")
    if not pointer:
        return None

    owner_id       = pointer["owner_id"]
    real_audit_id  = pointer["real_audit_id"]

    # Fetch the actual audit record
    item = table.get_item(Key={"user_id": owner_id, "audit_id": real_audit_id}).get("Item")
    if not item:
        return None
    return _to_native(item)
