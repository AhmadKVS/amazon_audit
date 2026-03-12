"""
Store URL smart lookup — Rainforest API + Perplexity-powered Account Scorecard.

Takes an Amazon Store URL + email, discovers real ASINs via Rainforest API,
fetches verified product data (images, A+ content, reviews, Brand Registry),
and returns an instant Listing Health Scorecard.

Falls back to Perplexity-only if Rainforest API is unavailable.
"""
import json
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.services.dynamo import save_audit as dynamo_save, set_share_token
from app.services.email_service import send_scorecard_email
from app.services.rainforest import (
    discover_asins,
    get_product_details,
    batch_product_details,
    extract_amazon_domain,
)

router = APIRouter()

PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search"
PERPLEXITY_CHAT_URL   = "https://api.perplexity.ai/chat/completions"


# ── Request / Response models ─────────────────────────────────────────────

class StoreLookupRequest(BaseModel):
    store_url: str
    email: str
    brand_name: str = ""


# ── Helpers ───────────────────────────────────────────────────────────────

def _require_any_key():
    if not settings.RAINFOREST_API_KEY and not settings.PERPLEXITY_API_KEY:
        raise HTTPException(503, "No AI service configured — add RAINFOREST_API_KEY or PERPLEXITY_API_KEY to .env")


def _perplexity_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
        "Content-Type": "application/json",
    }


def _extract_brand_from_url(url: str) -> str:
    """
    Extract a brand/store name from various Amazon URL formats.
    """
    parsed = urlparse(url.strip())
    path = parsed.path.strip("/")
    segments = [s for s in path.split("/") if s]

    # /stores/BrandName format
    if len(segments) >= 2 and segments[0].lower() == "stores":
        candidate = segments[1]
        if candidate.lower() != "page":
            return candidate.replace("-", " ").replace("+", " ").title()
        if len(segments) >= 3 and segments[1].lower() == "page":
            return ""

    # /sp?seller=XXXXX format
    if segments and segments[0].lower() == "sp":
        qs = parse_qs(parsed.query)
        seller = qs.get("seller", qs.get("me", [""]))[0]
        if seller:
            return ""

    # /Brand-Name/dp/ASIN or /Brand-Name/ format
    if segments and not segments[0].lower().startswith(("dp", "gp", "s?")):
        candidate = segments[0]
        if len(candidate) > 3 and not candidate.startswith("B0"):
            return candidate.replace("-", " ").replace("+", " ").title()

    return ""


def _extract_json(text: str) -> str:
    """Extract JSON object from LLM response that may include markdown fences."""
    text = text.strip()
    fence = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
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


# ── Rainforest-powered scorecard (PRIMARY) ────────────────────────────────

async def _rainforest_scorecard(client: httpx.AsyncClient, store_url: str, brand_hint: str) -> dict:
    """
    Use Rainforest API to discover real ASINs and fetch verified product data.
    Returns top 3 best-selling and top 3 lowest-selling products for this seller.
    """
    amazon_domain = extract_amazon_domain(store_url)
    print(f"[store-lookup] Rainforest: domain={amazon_domain}, brand={brand_hint!r}")

    # Stage 1: Discover all seller ASINs (up to 10)
    products = await discover_asins(client, store_url, brand_hint, amazon_domain)
    if not products:
        raise ValueError("No products found via Rainforest API")

    print(f"[store-lookup] Rainforest: discovered {len(products)} ASINs")

    # Sort all discovered products by review count (proxy for sales volume)
    products_sorted = sorted(products, key=lambda p: int(p.get("reviews", 0) or 0), reverse=True)

    # Pick top 3 best sellers + bottom 3 lowest sellers (no overlap)
    best_3 = products_sorted[:3]
    # Only show lowest sellers if we have more than 3 products
    if len(products_sorted) > 3:
        lowest_3 = products_sorted[-3:]
        lowest_3 = [p for p in lowest_3 if p["asin"] not in {b["asin"] for b in best_3}]
    else:
        lowest_3 = []

    # Stage 2: Get details for all 6 (or fewer) in parallel
    asins_to_fetch = [p["asin"] for p in best_3 + lowest_3 if p.get("asin")]
    details_list = await batch_product_details(client, asins_to_fetch, amazon_domain, max_concurrent=6)
    if not details_list:
        raise ValueError("Could not fetch product details")

    print(f"[store-lookup] Rainforest: got details for {len(details_list)} products")
    detail_map = {d["asin"]: d for d in details_list}

    def _enrich(p: dict) -> dict:
        d = detail_map.get(p["asin"], {})
        return {
            "asin": p["asin"],
            "title": d.get("title") or p.get("title", ""),
            "rating": d.get("rating") or p.get("rating", 0),
            "reviews": d.get("ratings_total") or p.get("reviews", 0),
            "price": d.get("price") or p.get("price", ""),
            "image": d.get("main_image") or p.get("image", ""),
            "link": d.get("link") or p.get("link") or f"https://www.{amazon_domain}/dp/{p['asin']}",
        }

    best_sellers = [_enrich(p) for p in best_3]
    lowest_sellers = [_enrich(p) for p in lowest_3]

    # Stage 3: Use top best seller as "main" for scorecard metrics
    main_asin = best_3[0]["asin"]
    main = detail_map.get(main_asin, details_list[0])

    has_a_plus = main.get("has_a_plus", False)
    brand_name = main.get("brand", "") or brand_hint
    brand_registry = has_a_plus or bool(main.get("has_brand_story"))

    # Collect prices across all products for range
    all_products = best_sellers + lowest_sellers
    prices = []
    for tp in all_products:
        nums = re.findall(r"[\d.]+", str(tp.get("price", "")))
        if nums:
            try:
                prices.append(float(nums[0]))
            except ValueError:
                pass

    price_range = ""
    if prices:
        price_range = f"${min(prices):.2f} - ${max(prices):.2f}" if len(prices) > 1 else f"${prices[0]:.2f}"

    avg_rating = main.get("rating", 0)
    review_count = main.get("ratings_total", 0)
    img_count = main.get("image_count", 0)

    flagged_issue = _generate_flagged_issue(main, brand_registry)
    competitive_summary = _build_competitive_summary(brand_name, main, best_sellers, has_a_plus, brand_registry)

    # Citations = all product page URLs (verified Amazon sources)
    citations = [store_url]
    for d in details_list:
        link = d.get("link", "") or f"https://www.{amazon_domain}/dp/{d['asin']}"
        if link and link not in citations:
            citations.append(link)

    return {
        "brand_name": brand_name or "Unknown Brand",
        "niche": "",
        "category": "",
        "category_avg_rating": 4.0,
        "top_listing": {
            "asin": main["asin"],
            "title": main.get("title", ""),
            "url": main.get("link", f"https://www.{amazon_domain}/dp/{main['asin']}"),
            "imageUrl": main.get("main_image", ""),
        },
        "image_count": img_count,
        "image_benchmark": 7,
        "image_urls": main.get("images", []),
        "a_plus_content": has_a_plus,
        "a_plus_proof_url": main.get("link", ""),
        "brand_registry": brand_registry,
        "brand_registry_evidence": (
            "A+ Content detected — requires Brand Registry enrollment"
            if has_a_plus else
            "Brand name found on listing" if brand_name else ""
        ),
        "review_count": review_count,
        "avg_rating": avg_rating,
        "rating_distribution": main.get("rating_distribution", {}),
        "price_range": price_range,
        "competitive_summary": competitive_summary,
        "flagged_issue": flagged_issue,
        "best_sellers": best_sellers,
        "lowest_sellers": lowest_sellers,
        "citations": citations,
        "data_source": "rainforest",
    }


def _generate_flagged_issue(main: dict, brand_registry: bool) -> str:
    """Generate a data-driven flagged issue from product details."""
    issues = []
    img_count = main.get("image_count", 0)
    rating = main.get("rating", 0)
    reviews = main.get("ratings_total", 0)

    if img_count < 5:
        issues.append(f"Main listing has only {img_count} images. Top sellers use 7-9 optimized images.")
    if not main.get("has_a_plus"):
        issues.append("No A+ Content detected. A+ Content can increase conversions by 5-10%.")
    if not brand_registry:
        issues.append("No Brand Registry detected. Register your brand to unlock A+ Content and brand protection.")
    if rating and rating < 4.0:
        issues.append(f"Average rating is {rating}/5. Products below 4.0 see significantly lower conversion rates.")
    if reviews < 50:
        issues.append(f"Only {reviews} reviews. Products with 100+ reviews see higher buyer confidence.")

    return issues[0] if issues else "Listing data retrieved successfully — review the scorecard for optimization opportunities."


def _build_competitive_summary(
    brand_name: str,
    main: dict,
    top_products: list,
    has_a_plus: bool,
    brand_registry: bool,
) -> str:
    """Build a competitive summary purely from Rainforest data — no AI required."""
    parts = []
    rating = main.get("rating", 0)
    reviews = main.get("ratings_total", 0)
    img_count = main.get("image_count", 0)
    price = main.get("price", "")

    if brand_name:
        parts.append(f"{brand_name} has {len(top_products)} product(s) listed on Amazon.")

    if rating and reviews:
        parts.append(f"Top listing holds {rating}/5 stars across {reviews:,} reviews.")

    if img_count:
        bench_note = "meets the 7-image benchmark" if img_count >= 7 else f"below the 7-image benchmark ({img_count} images)"
        parts.append(f"Main listing {bench_note}.")

    if has_a_plus:
        parts.append("A+ Content is active, confirming Brand Registry enrollment.")
    elif brand_registry:
        parts.append("Brand Registry is detected but A+ Content is not active — a quick win opportunity.")
    else:
        parts.append("No A+ Content or Brand Registry detected — both are high-priority opportunities.")

    return " ".join(parts) if parts else f"Rainforest data retrieved for {brand_name or 'this brand'}."


async def _perplexity_competitive_analysis(
    client: httpx.AsyncClient,
    brand_name: str,
    main_product: dict,
    top_products: list,
    amazon_domain: str,
) -> dict:
    """Use Perplexity sonar-pro to generate competitive analysis from real product data."""
    product_summary = "\n".join([
        f"- {p['title'][:80]} | Rating: {p['rating']} | Reviews: {p['reviews']} | Price: {p['price']}"
        for p in top_products[:5]
    ])

    user_prompt = (
        f"Brand: {brand_name}\n"
        f"Amazon domain: {amazon_domain}\n"
        f"Main product: {main_product.get('title', '')}\n"
        f"Images: {main_product.get('image_count', 0)}\n"
        f"A+ Content: {'Yes' if main_product.get('has_a_plus') else 'No'}\n"
        f"Rating: {main_product.get('rating', 0)}/5 ({main_product.get('ratings_total', 0)} reviews)\n\n"
        f"Product lineup:\n{product_summary}\n\n"
        "Based on this real product data, return a JSON object with:\n"
        "{\n"
        '  "category": "The product category/niche",\n'
        '  "category_avg_rating": 4.1,\n'
        '  "competitive_summary": "2-3 sentences comparing this brand to category leaders. Be specific about what competitors do better.",\n'
        '  "flagged_issue": "One specific, blunt issue based on the data above."\n'
        "}"
    )

    resp = await client.post(
        PERPLEXITY_CHAT_URL,
        headers=_perplexity_headers(),
        json={
            "model": "sonar-pro",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Amazon seller consultant. You have been given REAL product data "
                        "from Amazon. Analyze it and provide competitive context. "
                        "Respond with valid JSON only — no markdown, no explanation."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
        },
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(_extract_json(content))


# ── Perplexity-only scorecard (FALLBACK) ──────────────────────────────────

async def _perplexity_fallback_scorecard(client: httpx.AsyncClient, store_url: str, brand_hint: str) -> dict:
    """
    Original Perplexity-only scorecard generation.
    Used as fallback when Rainforest API is unavailable.
    """
    brand_q = f'"{brand_hint}"' if brand_hint else f"Amazon store {store_url}"

    queries = [
        f"{brand_q} Amazon store products listings top ASIN site:amazon.com",
        f"{brand_q} Amazon reviews rating A+ content images brand registry listing quality",
        f"{brand_q} Amazon seller category niche competitor benchmark",
    ]

    try:
        print(f"[store-lookup] Perplexity fallback: searching {len(queries)} queries for {brand_q}")
        resp = await client.post(
            PERPLEXITY_SEARCH_URL,
            headers=_perplexity_headers(),
            json={"query": queries, "max_results": 5},
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("results", [])
        grouped = [raw] if raw and not isinstance(raw[0], list) else raw
    except Exception as e:
        print(f"[store-lookup] Perplexity search failed: {e}")
        grouped = [[] for _ in queries]

    context_lines = []
    for query, results in zip(queries, grouped):
        context_lines.append(f"## Query: {query}")
        for r in results:
            context_lines.append(f"- {r.get('title', '')}: {r.get('snippet', '')} (source: {r.get('url', '')})")
        context_lines.append("")

    user_prompt = (
        f"Based on the following web research about the Amazon seller at {store_url}"
        + (f" (brand: {brand_hint})" if brand_hint else "")
        + f":\n\n{''.join(context_lines)}\n\n"
        "Analyze this seller's Amazon presence and return a JSON scorecard. "
        "Use real data from the search results. If a data point cannot be determined, "
        "use your best estimate and mark it clearly.\n\n"
        "Return ONLY a JSON object with these keys:\n"
        "{\n"
        '  "brand_name": "The brand/store name",\n'
        '  "niche": "The product category/niche",\n'
        '  "top_listing": { "asin": "B0XXXXXXXX", "title": "Product title" },\n'
        '  "image_count": 5,\n'
        '  "image_benchmark": 7,\n'
        '  "a_plus_content": true,\n'
        '  "brand_registry": true,\n'
        '  "review_count": 1234,\n'
        '  "avg_rating": 4.3,\n'
        '  "category": "Product category",\n'
        '  "category_avg_rating": 4.1,\n'
        '  "price_range": "$XX - $YY",\n'
        '  "flagged_issue": "One specific, blunt issue.",\n'
        '  "competitive_summary": "2-3 sentences on how this brand compares to category leaders"\n'
        "}"
    )

    resp = await client.post(
        PERPLEXITY_CHAT_URL,
        headers=_perplexity_headers(),
        json={
            "model": "sonar-pro",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert Amazon seller consultant. Analyze the provided web research "
                        "and produce a structured listing health scorecard. Be specific and data-driven. "
                        "Use actual numbers from the search results when available. "
                        "Respond with valid JSON only — no markdown, no explanation."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
        },
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    raw = json.loads(_extract_json(content))
    raw["data_source"] = "perplexity"
    return raw


# ── Scorecard builder ─────────────────────────────────────────────────────

def _scorecard_to_listing_health(raw: dict) -> dict:
    """Transform raw scorecard into the listingHealthSnapshot format."""
    image_count = raw.get("image_count", 0)
    image_bench = raw.get("image_benchmark", 7)
    avg_rating = raw.get("avg_rating", 0)
    cat_avg = raw.get("category_avg_rating", 4.0)
    review_count = raw.get("review_count", 0)
    data_source = raw.get("data_source", "perplexity")

    def _status(good_cond: bool, warn_cond: bool = True) -> str:
        if good_cond:
            return "good"
        if warn_cond:
            return "warning"
        return "critical"

    # Build main ASIN — include URL and image for Rainforest data
    top_listing = raw.get("top_listing", {})
    main_asin = {
        "asin": top_listing.get("asin", ""),
        "title": top_listing.get("title", ""),
    }
    if top_listing.get("url"):
        main_asin["url"] = top_listing["url"]
    if top_listing.get("imageUrl"):
        main_asin["imageUrl"] = top_listing["imageUrl"]

    # Image count with proof URLs
    image_data = {
        "count": image_count,
        "benchmark": image_bench,
        "status": _status(image_count >= image_bench, image_count >= image_bench - 2),
    }
    if raw.get("image_urls"):
        image_data["imageUrls"] = raw["image_urls"][:9]

    # A+ content with proof
    a_plus_data = {
        "present": bool(raw.get("a_plus_content")),
        "status": "good" if raw.get("a_plus_content") else "critical",
    }
    if raw.get("a_plus_proof_url"):
        a_plus_data["proofUrl"] = raw["a_plus_proof_url"]

    # Brand registry with evidence
    brand_reg_data = {
        "detected": bool(raw.get("brand_registry")),
        "status": "good" if raw.get("brand_registry") else "warning",
    }
    if raw.get("brand_registry_evidence"):
        brand_reg_data["evidence"] = raw["brand_registry_evidence"]
    if raw.get("brand_name"):
        brand_reg_data["brandName"] = raw["brand_name"]

    # Reviews with distribution
    review_data = {
        "rating": avg_rating,
        "reviewCount": review_count,
        "categoryAvg": cat_avg,
        "status": _status(avg_rating >= cat_avg, avg_rating >= cat_avg - 0.3),
    }
    if raw.get("rating_distribution"):
        review_data["ratingDistribution"] = raw["rating_distribution"]

    result = {
        "mainAsin": main_asin,
        "imageCount": image_data,
        "aPlusContent": a_plus_data,
        "brandRegistry": brand_reg_data,
        "reviewRating": review_data,
        "keyFinding": raw.get("flagged_issue", ""),
        "dataSource": data_source,
    }

    if raw.get("best_sellers"):
        result["bestSellers"] = raw["best_sellers"]

    if raw.get("lowest_sellers"):
        result["lowestSellers"] = raw["lowest_sellers"]

    # Keep topProducts for backward compat (best sellers)
    if raw.get("best_sellers"):
        result["topProducts"] = raw["best_sellers"]

    if raw.get("citations"):
        result["citations"] = raw["citations"]

    return result


# ── Endpoint ──────────────────────────────────────────────────────────────

@router.post("/store-lookup")
async def store_lookup(req: StoreLookupRequest, user: str = Depends(get_current_user)):
    """
    Instant Account Scorecard from an Amazon Store URL.
    Uses Rainforest API for real data, falls back to Perplexity web search.
    """
    _require_any_key()

    if not req.store_url.strip():
        raise HTTPException(400, "Store URL is required")
    if not req.email.strip():
        raise HTTPException(400, "Email is required")

    # User-supplied brand name takes priority over URL-extracted hint
    brand_hint = req.brand_name.strip() or _extract_brand_from_url(req.store_url)
    print(f"[store-lookup] URL={req.store_url!r} brand_hint={brand_hint!r}")

    raw_scorecard = None

    async with httpx.AsyncClient(timeout=120.0) as client:
        # PRIMARY: Rainforest API
        if settings.RAINFOREST_API_KEY:
            try:
                raw_scorecard = await _rainforest_scorecard(client, req.store_url, brand_hint)
                print(f"[store-lookup] Rainforest scorecard OK — source=rainforest")
            except Exception as e:
                print(f"[store-lookup] Rainforest failed: {type(e).__name__}: {e} — trying Perplexity fallback")

        # FALLBACK: Perplexity-only
        if raw_scorecard is None and settings.PERPLEXITY_API_KEY:
            try:
                raw_scorecard = await _perplexity_fallback_scorecard(client, req.store_url, brand_hint)
                print(f"[store-lookup] Perplexity fallback OK — source=perplexity")
            except httpx.TimeoutException:
                raise HTTPException(504, "Lookup timed out — try again")
            except httpx.HTTPStatusError as e:
                raise HTTPException(502, f"AI service error: {e.response.status_code}")
            except json.JSONDecodeError:
                raise HTTPException(500, "Could not parse AI response — try again")
            except Exception as e:
                print(f"[store-lookup] Perplexity fallback also failed: {e}")
                raise HTTPException(500, f"Lookup failed: {type(e).__name__}: {e}")

    if raw_scorecard is None:
        raise HTTPException(500, "All lookup methods failed — check API keys")

    # Build scorecard
    listing_health = _scorecard_to_listing_health(raw_scorecard)
    brand_name = raw_scorecard.get("brand_name", brand_hint or "Unknown Brand")
    niche = raw_scorecard.get("niche", "")
    category = raw_scorecard.get("category", niche)

    # Generate audit ID and save to DynamoDB
    audit_id = str(uuid.uuid4())

    audit_data = {
        "brand_name": brand_name,
        "niche": niche,
        "marketplace": "Amazon US",
        "report_type": "scorecard",
        "email": req.email.strip(),
        "s3_key": "",
        "brand_analysis": {
            "summary": raw_scorecard.get("competitive_summary", ""),
            "competitive_landscape": raw_scorecard.get("competitive_summary", ""),
            "top_seller_traits": [],
        },
        "recommendations": [],
        "benchmark_metrics": [],
        "csv_metadata": {},
        "citations": raw_scorecard.get("citations", []),
        "deep_analysis": {
            "listingHealthSnapshot": listing_health,
            "revenueGapReport": None,
            "adEfficiencySignal": None,
            "compiledReport": {
                "executiveSummary": raw_scorecard.get("competitive_summary", ""),
                "totalMonthlyOpportunity": None,
                "dataGaps": [
                    "No Business Report uploaded — upload to unlock Revenue Gap Analysis",
                    "No Search Terms Report uploaded — upload to unlock Ad Efficiency Signal",
                ],
                "topActions": [],
            },
        },
    }

    try:
        dynamo_save(user, audit_id, audit_data)
        print(f"[store-lookup] Saved audit {audit_id} for user {user[:8]}...")
    except Exception as e:
        print(f"[store-lookup] DynamoDB save warning: {e}")

    # Generate a share token
    share_token = None
    try:
        share_token = uuid.uuid4().hex
        set_share_token(user_id=user, audit_id=audit_id, token=share_token)
        print(f"[store-lookup] Share token created: {share_token[:8]}...")
    except Exception as e:
        print(f"[store-lookup] Share token creation warning: {e}")
        share_token = None

    # Send the scorecard email
    try:
        send_scorecard_email(
            to_email=req.email.strip(),
            brand_name=brand_name,
            scorecard_data=listing_health,
            audit_id=audit_id,
            share_token=share_token,
        )
    except Exception as e:
        print(f"[store-lookup] Email send warning: {e}")

    citations = raw_scorecard.get("citations", [])
    return {
        "audit_id": audit_id,
        "brand_name": brand_name,
        "niche": niche,
        "category": category,
        "scorecard": listing_health,
        "competitive_summary": raw_scorecard.get("competitive_summary", ""),
        "price_range": raw_scorecard.get("price_range", ""),
        "citations": citations,
    }
