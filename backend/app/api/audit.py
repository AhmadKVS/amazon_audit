"""
AI-powered audit endpoints — brand analysis & recommendations via Perplexity multi-query search.

Flow:
  POST /api/audit/analyze
    Step 1 — Multi-query Search: fire 5 targeted queries in ONE Perplexity Search API call,
             gathering web snippets on the brand, niche, competitors, and improvement strategies.
    Step 2 — Synthesis: pass all gathered snippets to a single chat completions call
             to produce structured brand_analysis + recommendations JSON.
"""
import json
import re
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import get_current_user, check_rate_limit
from app.services.dynamo import save_audit as dynamo_save, list_audits as dynamo_list, get_audit as dynamo_get, delete_audit as dynamo_delete, batch_get_audits as dynamo_batch_get, update_audit_field as dynamo_update_field

router = APIRouter()

PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search"
PERPLEXITY_CHAT_URL   = "https://api.perplexity.ai/chat/completions"

REPORT_LABELS = {
    "business_report": "Business Report",
    "active_listings": "Active Listings",
    "account_health":  "Account Health",
    "ads":             "Ads Performance",
    "fba_inventory":   "FBA Inventory",
}


# ── Request model ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    brand_name:    str
    niche:         str = ""
    marketplace:   str = "Amazon US"
    report_type:   str = "business_report"
    audit_purpose: str = ""
    notes:         str = ""


# ── Helpers ────────────────────────────────────────────────────────────────

def _require_key():
    if not settings.PERPLEXITY_API_KEY:
        raise HTTPException(503, "AI service not configured — add PERPLEXITY_API_KEY to .env")


def _extract_json(text: str) -> str:
    """
    Best-effort extraction of a JSON object from an LLM response that may
    include markdown code fences, preamble text, or trailing explanation.
    """
    text = text.strip()

    # Strip ```json ... ``` or ``` ... ``` fences (handles any language tag)
    fence_match = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    # If it already starts with '{', try it as-is first
    if text.startswith("{"):
        return text

    # Otherwise find the first '{' and the matching '}' using brace depth
    start = text.find("{")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        # Fallback: first '{' to last '}'
        end = text.rfind("}")
        if end > start:
            return text[start : end + 1]

    return text


def _auth_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
    }


async def _multi_search(
    client: httpx.AsyncClient,
    queries: list[str],
    max_results: int = 5,
) -> list[list[dict]]:
    """
    Call Perplexity multi-query Search API.
    Returns a list of result-lists, one per query (same order).
    Each result has: title, url, snippet, date.
    """
    resp = await client.post(
        PERPLEXITY_SEARCH_URL,
        headers=_auth_headers(),
        json={"query": queries, "max_results": max_results},
    )
    resp.raise_for_status()
    data = resp.json()
    raw = data.get("results", [])

    # Single-query returns a flat list; multi-query returns grouped lists.
    if raw and not isinstance(raw[0], list):
        return [raw]
    return raw


def _format_snippets(results: list[dict], label: str) -> str:
    """Format one query's search results into readable context text."""
    if not results:
        return f"## {label}\n[No results found]"
    lines = [f"## {label}"]
    for r in results:
        title   = r.get("title", "")
        snippet = r.get("snippet", "")
        url     = r.get("url", "")
        date    = r.get("date", "")
        date_str = f" [{date}]" if date else ""
        lines.append(f"- {title}{date_str}: {snippet}\n  Source: {url}")
    return "\n".join(lines)


async def _synthesize(client: httpx.AsyncClient, research_context: str, req: AnalyzeRequest) -> dict:
    """
    Pass all gathered search snippets to Perplexity chat completions
    and get back structured brand_analysis + recommendations JSON.
    """
    rtype        = REPORT_LABELS.get(req.report_type, req.report_type)
    purpose_line = f"\nSeller's stated goal: {req.audit_purpose}" if req.audit_purpose else ""
    notes_line   = f"\nAdditional context: {req.notes}" if req.notes else ""

    user_prompt = (
        f"Based on the following web research about the brand '{req.brand_name}' "
        f"in the '{req.niche or 'general Amazon products'}' niche on {req.marketplace}, "
        f"selling via {rtype} reports:{purpose_line}{notes_line}\n\n"
        f"{research_context}\n\n"
        "Return a single JSON object with EXACTLY these three top-level keys:\n"
        "1. \"brand_analysis\": {\n"
        "     \"summary\": \"<2-3 sentence overview of the brand and its market position>\",\n"
        "     \"competitive_landscape\": \"<2-3 sentences on competitive dynamics and key success drivers>\",\n"
        "     \"top_seller_traits\": [\"<trait>\", \"<trait>\", \"<trait>\", \"<trait>\"],\n"
        "     \"summary_bullets\": {\n"
        "         \"strongest_points\": \"<1 sentence: what this brand does best on Amazon>\",\n"
        "         \"areas_of_improvement\": \"<1 sentence: the biggest gap or weakness to address>\",\n"
        "         \"revlyn_help\": \"<1 sentence: how Revlyn can specifically help this brand grow>\"\n"
        "     }\n"
        "   }\n"
        "2. \"recommendations\": [\n"
        "     {\"title\": \"<short action title>\", "
        "\"description\": \"<1-2 sentence concrete action>\", "
        "\"priority\": \"high\" or \"medium\" or \"low\"},\n"
        "     ... (5-7 recommendations, tailored to this brand/niche)\n"
        "   ]"
    )

    print(f"[audit] Calling Perplexity chat completions (sonar-pro) with {len(research_context)} chars context")
    resp = await client.post(
        PERPLEXITY_CHAT_URL,
        headers=_auth_headers(),
        json={
            "model": "sonar-pro",
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "audit_synthesis",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "brand_analysis": {
                                "type": "object",
                                "properties": {
                                    "summary": {"type": "string"},
                                    "competitive_landscape": {"type": "string"},
                                    "top_seller_traits": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "summary_bullets": {
                                        "type": "object",
                                        "properties": {
                                            "strongest_points": {"type": "string"},
                                            "areas_of_improvement": {"type": "string"},
                                            "revlyn_help": {"type": "string"},
                                        },
                                        "required": ["strongest_points", "areas_of_improvement", "revlyn_help"],
                                    },
                                },
                                "required": ["summary", "competitive_landscape", "top_seller_traits", "summary_bullets"],
                            },
                            "recommendations": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "title": {"type": "string"},
                                        "description": {"type": "string"},
                                        "priority": {
                                            "type": "string",
                                            "enum": ["high", "medium", "low"],
                                        },
                                    },
                                    "required": ["title", "description", "priority"],
                                },
                            },
                        },
                        "required": ["brand_analysis", "recommendations"],
                    },
                },
            },
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Amazon seller consultant and structured data API. "
                        "Synthesise the provided web research into actionable insights. "
                        "Respond with valid JSON only — no markdown, no explanation, no code fences."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
        },
    )
    print(f"[audit] Perplexity response status: {resp.status_code}")
    resp.raise_for_status()
    resp_json = resp.json()
    try:
        content = resp_json["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        print(f"[audit] Unexpected Perplexity response structure: {e}")
        print(f"[audit] Response keys: {list(resp_json.keys()) if isinstance(resp_json, dict) else type(resp_json)}")
        raise ValueError(f"Unexpected Perplexity response: {str(resp_json)[:300]}")
    print(f"[audit] Perplexity content (first 200 chars): {content[:200]}")
    return json.loads(_extract_json(content))


# ── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze(req: AnalyzeRequest, user: str = Depends(get_current_user), _rl=Depends(check_rate_limit)):
    """
    Full AI audit: multi-query Perplexity search + synthesis.

    Step 1: Fire 5 targeted queries in a SINGLE Perplexity Search API call.
    Step 2: Synthesise all gathered snippets via one chat completions call.

    Returns brand_analysis, recommendations, raw search_results, and citations.
    """
    _require_key()

    brand  = req.brand_name
    niche  = req.niche or "general Amazon products"
    market = req.marketplace
    rtype  = REPORT_LABELS.get(req.report_type, req.report_type)

    # ── Step 1: Multi-query search ─────────────────────────────────────────
    # Up to 5 queries per the Perplexity multi-query limit.
    queries = [
        f"{brand} Amazon seller brand overview {niche}",
        f"{niche} Amazon top sellers competitive landscape {market} 2024 2025",
        f"Amazon {rtype} improvement best practices strategies {niche} sellers",
        f"{brand} Amazon customer reviews product quality reputation",
        f"Amazon seller {niche} niche growth opportunities trends 2025",
    ]

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:

            try:
                print(f"[audit] Step 1: Calling Perplexity multi-search with {len(queries)} queries")
                grouped = await _multi_search(client, queries, max_results=5)
                print(f"[audit] Step 1: Search returned {sum(len(g) for g in grouped)} total results")
            except httpx.HTTPStatusError as search_err:
                # Search API unavailable on this plan — proceed with empty context
                print(f"[audit] Step 1: Search API failed ({search_err.response.status_code}) — continuing with empty context")
                grouped = [[] for _ in queries]
            except Exception as search_err:
                print(f"[audit] Step 1: Search API error ({type(search_err).__name__}: {search_err}) — continuing with empty context")
                grouped = [[] for _ in queries]

            # Collect URLs and build context text from all result groups
            all_urls: list[str] = []
            context_sections: list[str] = []

            for query, results in zip(queries, grouped):
                context_sections.append(_format_snippets(results, query))
                for r in results:
                    if url := r.get("url"):
                        all_urls.append(url)

            research_context = "\n\n".join(context_sections)

            # ── Step 2: Synthesis (with one retry on parse failure) ────────
            try:
                synthesis = await _synthesize(client, research_context, req)
            except json.JSONDecodeError:
                synthesis = await _synthesize(client, research_context, req)

    except httpx.TimeoutException:
        raise HTTPException(504, "AI service timed out — try again")
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text
        except Exception:
            pass
        print(f"[audit] Perplexity API error {e.response.status_code}: {detail}")
        raise HTTPException(502, f"Perplexity API error {e.response.status_code}: {detail}")
    except json.JSONDecodeError:
        raise HTTPException(500, "Could not parse AI synthesis response — try again")
    except Exception as e:
        print(f"[audit] Unexpected error: {type(e).__name__}: {e}")
        raise HTTPException(500, f"Audit analysis failed: {type(e).__name__}: {e}")

    brand_analysis  = synthesis.get("brand_analysis", {})
    recommendations = synthesis.get("recommendations", [])
    citations       = list(dict.fromkeys(all_urls))[:6]  # deduplicated, top 6

    return {
        "brand_name":  brand,
        "niche":       req.niche,
        "marketplace": market,
        "brand_analysis": {
            "summary":               brand_analysis.get("summary", ""),
            "competitive_landscape": brand_analysis.get("competitive_landscape", ""),
            "top_seller_traits":     brand_analysis.get("top_seller_traits", []),
            "summary_bullets":       brand_analysis.get("summary_bullets", {}),
        },
        "recommendations": recommendations,
        "search_results": [
            {
                "query":   query,
                "results": [
                    {
                        "title":   r.get("title", ""),
                        "url":     r.get("url", ""),
                        "snippet": r.get("snippet", ""),
                        "date":    r.get("date", ""),
                    }
                    for r in results
                ],
            }
            for query, results in zip(queries, grouped)
        ],
        "citations": citations,
    }


# ── Save & List ────────────────────────────────────────────────────────────

class SaveAuditRequest(BaseModel):
    audit_id:         str
    brand_name:       str
    niche:            str  = ""
    marketplace:      str  = "Amazon US"
    report_type:      str  = "business_report"
    audit_purpose:    str  = ""
    notes:            str  = ""
    brand_analysis:   dict = {}
    recommendations:  list = []
    benchmark_metrics: list = []
    csv_metadata:     dict = {}
    citations:        list = []
    s3_key:           str  = ""
    deep_analysis:    dict = {}
    email:            str  = ""


@router.post("/save")
async def save_audit(req: SaveAuditRequest, user: str = Depends(get_current_user)):
    """Persist a completed audit to DynamoDB."""
    try:
        dynamo_save(user, req.audit_id, req.model_dump())
    except Exception as e:
        raise HTTPException(500, f"Failed to save audit: {e}")
    return {"saved": True}


@router.get("/list")
async def list_audits(user: str = Depends(get_current_user)):
    """Return all saved audits for the current user, newest first."""
    print(f"[audit] /list called — authenticated user_id={user!r}")
    try:
        audits = dynamo_list(user)
    except Exception as e:
        print(f"[audit] /list error: {e}")
        raise HTTPException(500, f"Failed to list audits: {e}")
    print(f"[audit] /list returning {len(audits)} audits")
    return {"audits": audits}


@router.get("/debug-users")
async def debug_users(user: str = Depends(get_current_user)):
    """TEMPORARY: Show all distinct user_ids in the table for debugging."""
    import boto3 as _boto3
    table = _boto3.resource(
        "dynamodb",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    ).Table(settings.DYNAMODB_TABLE)
    resp = table.scan(ProjectionExpression="user_id, audit_id, brand_name, created_at")
    items = resp.get("Items", [])
    return {
        "current_user": user,
        "total_items": len(items),
        "items": [
            {
                "user_id": item.get("user_id"),
                "audit_id": item.get("audit_id"),
                "brand_name": item.get("brand_name", ""),
                "created_at": item.get("created_at", ""),
            }
            for item in items
        ],
    }


# ── Batch fetch full audits ────────────────────────────────────────────────

class BatchRequest(BaseModel):
    audit_ids: list[str]


@router.post("/batch")
async def batch_audits(req: BatchRequest, user: str = Depends(get_current_user)):
    """Return full audit records for a list of audit_ids in one call."""
    if len(req.audit_ids) > 200:
        raise HTTPException(400, "Too many audit_ids (max 200)")
    try:
        items = dynamo_batch_get(user, req.audit_ids)
    except Exception as e:
        raise HTTPException(500, f"Batch fetch failed: {e}")
    return {"audits": items}


# ── Update deep analysis on existing audit ────────────────────────────────

class UpdateDeepAnalysisRequest(BaseModel):
    audit_id: str
    deep_analysis: dict


@router.post("/update-deep-analysis")
async def update_deep_analysis(req: UpdateDeepAnalysisRequest, user: str = Depends(get_current_user)):
    """Update just the deep_analysis field on an existing audit (no overwrite)."""
    try:
        dynamo_update_field(user, req.audit_id, "deep_analysis", req.deep_analysis)
    except Exception as e:
        raise HTTPException(500, f"Failed to update deep analysis: {e}")
    return {"updated": True}


# ── Delete single audit (MUST be before /{audit_id} GET) ──────────────────

@router.delete("/{audit_id}")
async def delete_audit(audit_id: str, user: str = Depends(get_current_user)):
    """Delete a single saved audit for the current user."""
    try:
        dynamo_delete(user, audit_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to delete audit: {e}")
    return {"success": True}


# ── Get single audit (MUST be after /list and /debug-users) ───────────────

@router.get("/{audit_id}")
async def get_audit(audit_id: str, user: str = Depends(get_current_user)):
    """Return a single saved audit. Returns 404 if not found."""
    item = dynamo_get(user, audit_id)
    if not item:
        raise HTTPException(404, "Audit not found")
    return item
