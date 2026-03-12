"""
Business Report Analysis — per-ASIN diagnostic ratings, before/after projections,
and executive summary via Perplexity Sonar.

Flow:
  POST /api/business-report/analyze
    Step 1 — Deterministic diagnostics: classify each ASIN using Sessions × CR matrix.
    Step 2 — AI synthesis: explanations, actions, before/after projections, executive summary.
"""
import json
import statistics
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import get_current_user, check_rate_limit
from app.services.dynamo import save_audit as dynamo_save, get_audit as dynamo_get

router = APIRouter()

PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions"


# ── Request / Response models ─────────────────────────────────────────────

class AsinMetrics(BaseModel):
    asin: str
    title: str = ""
    sessions: float = 0
    conversion_rate: float = 0  # percentage
    units_sold: float = 0
    revenue: float = 0
    ad_spend: float = 0
    acos: float = 0  # percentage


class BusinessReportRequest(BaseModel):
    brand_name: str
    niche: str = ""
    marketplace: str = "Amazon US"
    audit_purpose: str = ""
    notes: str = ""
    asin_metrics: list[AsinMetrics]


class SaveBusinessReportRequest(BaseModel):
    audit_id: str
    brand_name: str
    niche: str = ""
    marketplace: str = "Amazon US"
    audit_purpose: str = ""
    notes: str = ""
    diagnostics: list = []
    before_after: list = []
    executive_summary: dict = {}
    csv_metadata: dict = {}
    citations: list = []


# ── Helpers (shared with audit.py patterns) ───────────────────────────────

def _require_key():
    if not settings.PERPLEXITY_API_KEY:
        raise HTTPException(503, "AI service not configured — add PERPLEXITY_API_KEY to .env")


def _auth_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
    }


def _extract_json(text: str) -> str:
    """Best-effort extraction of a JSON object from an LLM response."""
    import re
    text = text.strip()
    fence_match = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if fence_match:
        text = fence_match.group(1).strip()
    if text.startswith("{"):
        return text
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
        end = text.rfind("}")
        if end > start:
            return text[start : end + 1]
    return text


# ── Diagnostic matrix ─────────────────────────────────────────────────────

DIAGNOSIS_MAP = {
    (True, True):   ("HEALTHY",       "High Sessions + High Conversion Rate"),
    (True, False):  ("LISTING_ISSUE", "High Sessions + Low Conversion Rate"),
    (False, True):  ("TRAFFIC_ISSUE", "Low Sessions + High Conversion Rate"),
    (False, False): ("CRITICAL",      "Low Sessions + Low Conversion Rate"),
}


def _compute_diagnostics(metrics: list[AsinMetrics]) -> list[dict]:
    """Apply the diagnostic matrix to each ASIN using median thresholds."""
    if not metrics:
        return []

    sessions_vals = [m.sessions for m in metrics if m.sessions > 0]
    cr_vals = [m.conversion_rate for m in metrics if m.conversion_rate > 0]

    # Use median as threshold; fall back to reasonable defaults
    session_threshold = statistics.median(sessions_vals) if sessions_vals else 100
    cr_threshold = statistics.median(cr_vals) if cr_vals else 10

    results = []
    for m in metrics:
        high_sessions = m.sessions >= session_threshold
        high_cr = m.conversion_rate >= cr_threshold
        diagnosis, reason = DIAGNOSIS_MAP[(high_sessions, high_cr)]

        results.append({
            "asin": m.asin,
            "title": m.title,
            "sessions": m.sessions,
            "conversion_rate": m.conversion_rate,
            "units_sold": m.units_sold,
            "revenue": m.revenue,
            "ad_spend": m.ad_spend,
            "acos": m.acos,
            "diagnosis": diagnosis,
            "diagnosis_reason": reason,
            "explanation": "",   # filled by AI
            "top_actions": [],   # filled by AI
        })

    return results


# ── AI synthesis ──────────────────────────────────────────────────────────

async def _ai_synthesize(
    client: httpx.AsyncClient,
    diagnostics: list[dict],
    req: BusinessReportRequest,
) -> dict:
    """
    Single Perplexity Sonar call to generate:
    - per-ASIN explanations and top 3 actions
    - before/after projections per ASIN
    - executive summary (health score, wins, risks, priorities)
    """
    # Build the diagnostics context
    asin_lines = []
    for d in diagnostics:
        asin_lines.append(
            f"ASIN {d['asin']} \"{d['title']}\":\n"
            f"  Sessions: {d['sessions']}, CR: {d['conversion_rate']}%, "
            f"Units Sold: {d['units_sold']}, Revenue: ${d['revenue']:.2f}, "
            f"Ad Spend: ${d['ad_spend']:.2f}, ACOS: {d['acos']}%\n"
            f"  Diagnosis: {d['diagnosis']} ({d['diagnosis_reason']})"
        )
    asin_context = "\n\n".join(asin_lines)

    total_asins = len(diagnostics)
    healthy = sum(1 for d in diagnostics if d["diagnosis"] == "HEALTHY")
    listing_issues = sum(1 for d in diagnostics if d["diagnosis"] == "LISTING_ISSUE")
    traffic_issues = sum(1 for d in diagnostics if d["diagnosis"] == "TRAFFIC_ISSUE")
    critical = sum(1 for d in diagnostics if d["diagnosis"] == "CRITICAL")
    total_rev = sum(d["revenue"] for d in diagnostics)
    avg_cr = statistics.mean([d["conversion_rate"] for d in diagnostics]) if diagnostics else 0

    purpose_line = f"\nSeller's goal: {req.audit_purpose}" if req.audit_purpose else ""
    notes_line = f"\nAdditional context: {req.notes}" if req.notes else ""

    user_prompt = (
        f"Analyze this Amazon Business Report for brand '{req.brand_name}' "
        f"in the '{req.niche or 'general'}' niche on {req.marketplace}.{purpose_line}{notes_line}\n\n"
        f"== ASIN Performance Data ==\n{asin_context}\n\n"
        f"== Summary ==\n"
        f"Total ASINs: {total_asins}, Healthy: {healthy}, Listing Issues: {listing_issues}, "
        f"Traffic Issues: {traffic_issues}, Critical: {critical}\n"
        f"Average CR: {avg_cr:.1f}%, Total Revenue: ${total_rev:.2f}\n\n"
        "Return a JSON object with EXACTLY these keys:\n"
        "1. \"asin_details\": array, one per ASIN, each with:\n"
        "   - \"asin\": string\n"
        "   - \"explanation\": 1-2 sentence explanation of why this diagnosis was given\n"
        "   - \"top_actions\": array of 3 specific actionable recommendations\n"
        "2. \"before_after\": array, one per ASIN, each with:\n"
        "   - \"asin\": string\n"
        "   - \"projected_sessions\": number (projected after optimization)\n"
        "   - \"projected_conversion_rate\": number (projected %)\n"
        "   - \"projected_revenue\": number (projected $)\n"
        "   - \"changes_summary\": array of objects {\"change\": string, \"expected_impact\": string}\n"
        "3. \"executive_summary\": object with:\n"
        "   - \"health_score\": integer 1-10\n"
        "   - \"top_wins\": array of 3 strings (positive observations)\n"
        "   - \"top_risks\": array of 3 strings (risks or problem areas)\n"
        "   - \"thirty_day_priorities\": array of 3-5 strings\n"
        "   - \"ninety_day_priorities\": array of 3-5 strings"
    )

    resp = await client.post(
        PERPLEXITY_CHAT_URL,
        headers=_auth_headers(),
        json={
            "model": "sonar-pro",
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "business_report_analysis",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "asin_details": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "asin": {"type": "string"},
                                        "explanation": {"type": "string"},
                                        "top_actions": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        },
                                    },
                                    "required": ["asin", "explanation", "top_actions"],
                                },
                            },
                            "before_after": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "asin": {"type": "string"},
                                        "projected_sessions": {"type": "number"},
                                        "projected_conversion_rate": {"type": "number"},
                                        "projected_revenue": {"type": "number"},
                                        "changes_summary": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "change": {"type": "string"},
                                                    "expected_impact": {"type": "string"},
                                                },
                                                "required": ["change", "expected_impact"],
                                            },
                                        },
                                    },
                                    "required": ["asin", "projected_sessions", "projected_conversion_rate", "projected_revenue", "changes_summary"],
                                },
                            },
                            "executive_summary": {
                                "type": "object",
                                "properties": {
                                    "health_score": {"type": "integer"},
                                    "top_wins": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "top_risks": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "thirty_day_priorities": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "ninety_day_priorities": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": ["health_score", "top_wins", "top_risks", "thirty_day_priorities", "ninety_day_priorities"],
                            },
                        },
                        "required": ["asin_details", "before_after", "executive_summary"],
                    },
                },
            },
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Amazon seller consultant and structured data API. "
                        "Analyze the provided ASIN performance data and generate actionable insights. "
                        "Respond with valid JSON only — no markdown, no explanation, no code fences."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
        },
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(_extract_json(content))


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze(req: BusinessReportRequest, user: str = Depends(get_current_user), _rl=Depends(check_rate_limit)):
    """
    Generate a full business report: diagnostics + AI-powered analysis.

    Step 1: Deterministic diagnostic matrix (Sessions × CR).
    Step 2: AI synthesis for explanations, projections, and executive summary.
    """
    _require_key()

    if not req.asin_metrics:
        raise HTTPException(400, "At least one ASIN with metrics is required")

    # Step 1: deterministic diagnostics
    diagnostics = _compute_diagnostics(req.asin_metrics)

    # Step 2: AI synthesis
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                synthesis = await _ai_synthesize(client, diagnostics, req)
            except json.JSONDecodeError:
                # Retry once on parse failure
                synthesis = await _ai_synthesize(client, diagnostics, req)
    except httpx.TimeoutException:
        raise HTTPException(504, "AI service timed out — try again")
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text
        except Exception:
            pass
        print(f"[business-report] Perplexity API error {e.response.status_code}: {detail}")
        raise HTTPException(502, f"Perplexity API error {e.response.status_code}: {detail}")
    except json.JSONDecodeError:
        raise HTTPException(500, "Could not parse AI response — try again")

    # Merge AI results into diagnostics
    asin_details = {d["asin"]: d for d in synthesis.get("asin_details", [])}
    for diag in diagnostics:
        ai = asin_details.get(diag["asin"], {})
        diag["explanation"] = ai.get("explanation", "")
        diag["top_actions"] = ai.get("top_actions", [])

    # Build before/after with current + projected data
    before_after = []
    ba_map = {ba["asin"]: ba for ba in synthesis.get("before_after", [])}
    for diag in diagnostics:
        projected = ba_map.get(diag["asin"], {})
        before_after.append({
            "asin": diag["asin"],
            "title": diag["title"],
            "current": {
                "sessions": diag["sessions"],
                "conversion_rate": diag["conversion_rate"],
                "units_sold": diag["units_sold"],
                "revenue": diag["revenue"],
                "ad_spend": diag["ad_spend"],
                "acos": diag["acos"],
            },
            "projected": {
                "sessions": projected.get("projected_sessions", diag["sessions"]),
                "conversion_rate": projected.get("projected_conversion_rate", diag["conversion_rate"]),
                "revenue": projected.get("projected_revenue", diag["revenue"]),
            },
            "changes_summary": projected.get("changes_summary", []),
        })

    executive_summary = synthesis.get("executive_summary", {
        "health_score": 5,
        "top_wins": [],
        "top_risks": [],
        "thirty_day_priorities": [],
        "ninety_day_priorities": [],
    })

    # Collect citations from Perplexity response
    citations = []
    try:
        raw_resp = synthesis.get("citations", [])
        if isinstance(raw_resp, list):
            citations = raw_resp[:6]
    except Exception:
        pass

    return {
        "brand_name": req.brand_name,
        "niche": req.niche,
        "marketplace": req.marketplace,
        "diagnostics": diagnostics,
        "before_after": before_after,
        "executive_summary": executive_summary,
        "citations": citations,
    }


@router.post("/save")
async def save_report(req: SaveBusinessReportRequest, user: str = Depends(get_current_user)):
    """Persist a completed business report to DynamoDB."""
    try:
        data = req.model_dump()
        data["report_kind"] = "business_report_analysis"
        dynamo_save(user, req.audit_id, data)
    except Exception as e:
        raise HTTPException(500, f"Failed to save report: {e}")
    return {"saved": True}


@router.get("/{audit_id}")
async def get_report(audit_id: str, user: str = Depends(get_current_user)):
    """Return a saved business report. Returns 404 if not found."""
    item = dynamo_get(user, audit_id)
    if not item:
        raise HTTPException(404, "Business report not found")
    return item
