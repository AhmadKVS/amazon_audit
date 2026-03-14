"""
Store URL smart lookup — Rainforest API + Perplexity-powered Account Scorecard.

Takes an Amazon Store URL + email, discovers real ASINs via Rainforest API,
fetches verified product data (images, A+ content, reviews, Brand Registry),
and returns an instant Listing Health Scorecard.

Falls back to Perplexity-only if Rainforest API is unavailable.
"""
import asyncio
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
    extract_amazon_domain,
    brand_search,
    _extract_store_slug,
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

    2-call pipeline (Option A):
      Call 1: discover_asins() via type=store max_page=5 — all products with full data
              (title, rating, reviews, price, image already included in store_results)
      Call 2: get_product_details(best_seller_asin) — A+, image_count, brand registry only
      Optional Call 3: brand_search() top-up — only fires when < 4 products discovered
    """
    amazon_domain = extract_amazon_domain(store_url)
    print(f"[store-lookup] Rainforest: domain={amazon_domain}, brand={brand_hint!r}")

    # Call 1: Discover all products — type=store returns full data so no batch detail call needed
    products = await discover_asins(client, store_url, brand_hint, amazon_domain)
    if not products:
        raise ValueError("No products found via Rainforest API")

    print(f"[store-lookup] discovered {len(products)} products")

    # Optional top-up: only when store returned too few products for meaningful ranking.
    if len(products) < 4:
        store_slug = _extract_store_slug(store_url)
        topup_candidates: list[str] = []
        if store_slug:
            topup_candidates.append(store_slug)
        if brand_hint and not any(brand_hint.lower() == c.lower() for c in topup_candidates):
            topup_candidates.append(brand_hint)
        # Also try the brand name found on the discovered products themselves (e.g. from lp_asin detail)
        for p in products:
            detected_brand = p.get("brand", "")
            if detected_brand and not any(detected_brand.lower() == c.lower() for c in topup_candidates):
                topup_candidates.append(detected_brand)
                break

        existing_asins = {p["asin"] for p in products}
        for candidate in topup_candidates:
            if not candidate:
                continue
            try:
                extra = await brand_search(client, candidate, amazon_domain, max_pages=5)
                new_ones = [p for p in extra if p.get("asin") and p["asin"] not in existing_asins]
                if new_ones:
                    products = (products + new_ones)[:50]
                    existing_asins = {p["asin"] for p in products}
                    print(f"[store-lookup] top-up to {len(products)} via brand_search({candidate!r})")
                    break  # First successful top-up is enough
            except Exception as e:
                print(f"[store-lookup] brand top-up ({candidate!r}) failed: {e}")

    # Deduplicate by ASIN
    seen_asins: set[str] = set()
    deduped = []
    for p in products:
        if p["asin"] not in seen_asins:
            seen_asins.add(p["asin"])
            deduped.append(p)
    products = deduped

    # Deduplicate color/size variants — keep only the highest-review variant per product family.
    # Variants share the same base title up to the first "|", ",", "-" separator that introduces
    # a color/size qualifier (e.g. "Spinning Chair - Blue" and "Spinning Chair - Red" → same family).
    def _base_title(title: str) -> str:
        """Strip trailing variant qualifiers to get a normalised base title for grouping."""
        t = title.strip()
        # Cut at common variant separators
        for sep in (" | ", " - ", ", "):
            if sep in t:
                t = t.split(sep)[0].strip()
        # Remove trailing bracketed/parenthetical size/color info
        t = re.sub(r"\s*[\(\[].+[\)\]]$", "", t).strip()
        # Lowercase + collapse whitespace for comparison
        return re.sub(r"\s+", " ", t.lower())

    family_map: dict[str, dict] = {}
    for p in products:
        key = _base_title(p.get("title", p["asin"]))
        existing = family_map.get(key)
        if existing is None or int(p.get("reviews", 0) or 0) > int(existing.get("reviews", 0) or 0):
            family_map[key] = p
    products = list(family_map.values())
    print(f"[store-lookup] after variant dedup: {len(products)} unique products")

    # Drop stub products — store API sometimes returns entries with only asin/link and no real data.
    # These have no title, no image, and 0 reviews so they're useless for ranking or display.
    products = [p for p in products if p.get("title") or p.get("image") or int(p.get("reviews", 0) or 0) > 0]
    print(f"[store-lookup] after stub filter: {len(products)} displayable products")

    # Sort by review count (already available from Call 1 store data)
    products_sorted = sorted(products, key=lambda p: int(p.get("reviews", 0) or 0), reverse=True)

    # Pick top 3 best sellers + bottom 3 lowest sellers (no overlap)
    best_3 = products_sorted[:3]
    best_asins = {p["asin"] for p in best_3}
    remaining = [p for p in products_sorted if p["asin"] not in best_asins]
    lowest_3 = remaining[-3:] if remaining else []

    best_sellers = best_3
    lowest_sellers = lowest_3

    # Call 2: Fetch full details for best-seller (A+, image_count, brand registry)
    # + any displayed product still missing image or reviews — all in one concurrent batch.
    main_asin = best_3[0]["asin"]
    displayed = best_sellers + lowest_sellers
    sparse_asins = [
        p["asin"] for p in displayed
        if p["asin"] != main_asin and (not p.get("image") or not int(p.get("reviews", 0) or 0))
    ]
    print(f"[store-lookup] fetching details: main={main_asin!r} sparse={sparse_asins}")

    fetch_results = await asyncio.gather(
        get_product_details(client, main_asin, amazon_domain),
        *[get_product_details(client, asin, amazon_domain) for asin in sparse_asins],
        return_exceptions=True,
    )
    main = fetch_results[0] if isinstance(fetch_results[0], dict) else best_3[0]

    # Merge any sparse results back into the display lists
    sparse_map = {
        r["asin"]: r
        for r in fetch_results[1:]
        if isinstance(r, dict) and r.get("asin")
    }
    def _merge(p: dict) -> dict:
        d = sparse_map.get(p["asin"])
        if not d:
            return p
        return {
            "asin": p["asin"],
            "title": d.get("title") or p.get("title", ""),
            "rating": d.get("rating") or p.get("rating", 0),
            "reviews": d.get("ratings_total") or p.get("reviews", 0),
            "price": d.get("price") or p.get("price", ""),
            "image": d.get("main_image") or p.get("image", ""),
            "link": d.get("link") or p.get("link", ""),
        }
    best_sellers = [_merge(p) for p in best_sellers]
    lowest_sellers = [_merge(p) for p in lowest_sellers]

    has_a_plus = main.get("has_a_plus", False)
    brand_name = main.get("brand", "") or brand_hint
    brand_registry = has_a_plus or bool(main.get("has_brand_story"))

    # Collect prices across displayed products for range
    prices = []
    for tp in best_sellers + lowest_sellers:
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
    total_found = len(products_sorted)
    if total_found == 1:
        flagged_issue = f"Only 1 product found for this brand on Amazon. {flagged_issue}"
    elif total_found < 4:
        flagged_issue = f"Only {total_found} products found for this brand — best/lowest ranking may be limited. {flagged_issue}"
    competitive_summary = _build_competitive_summary(brand_name, main, best_sellers, has_a_plus, brand_registry)

    # Ensure every product has a proper Amazon link (no API call needed — build from ASIN)
    def _with_link(p: dict) -> dict:
        if not p.get("link"):
            p = {**p, "link": f"https://www.{amazon_domain}/dp/{p['asin']}"}
        return p

    best_sellers = [_with_link(p) for p in best_sellers]
    lowest_sellers = [_with_link(p) for p in lowest_sellers]

    # Citations: store URL + all discovered product pages (built from ASINs, no API call)
    seen_citations: set[str] = {store_url}
    citations = [store_url]
    for p in products_sorted:
        link = p.get("link") or f"https://www.{amazon_domain}/dp/{p['asin']}"
        if link not in seen_citations:
            seen_citations.add(link)
            citations.append(link)

    return {
        "brand_name": brand_name or "Unknown Brand",
        "niche": "",
        "category": "",
        "category_avg_rating": 4.0,
        "top_listing": {
            "asin": main_asin,
            "title": main.get("title", ""),
            "url": main.get("link", f"https://www.{amazon_domain}/dp/{main_asin}"),
            "imageUrl": main.get("main_image", "") or best_3[0].get("image", ""),
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
    """Generate a data-driven key finding from real product details."""
    img_count = main.get("image_count", 0)
    rating = main.get("rating", 0)
    reviews = main.get("ratings_total", 0)
    has_a_plus = main.get("has_a_plus", False)
    title = main.get("title", "")
    asin = main.get("asin", "")
    price = main.get("price", "")

    # Build a short product reference for context
    product_ref = f'"{title[:50]}..."' if len(title) > 50 else f'"{title}"' if title else f"ASIN {asin}"

    # Critical issues first — most impactful single finding
    if img_count and img_count < 5:
        return (
            f"{product_ref} has only {img_count} listing images — well below the 7-image benchmark. "
            f"Amazon data shows listings with 7+ images convert up to 30% better."
        )
    if rating and rating < 4.0:
        return (
            f"{product_ref} is rated {rating}/5 across {reviews:,} reviews. "
            f"Listings below 4.0 stars lose the buy box to competitors and rank lower in search."
        )
    if reviews < 50 and reviews > 0:
        return (
            f"{product_ref} has only {reviews} reviews. "
            f"Listings with fewer than 50 reviews struggle to rank on page 1 — a review generation campaign is the highest-leverage next step."
        )
    if not has_a_plus and not brand_registry:
        return (
            f"{product_ref} has no A+ Content and no Brand Registry detected. "
            f"Brand Registry unlocks A+ Content, Sponsored Brands ads, and brand protection — all currently unavailable."
        )
    if not has_a_plus and brand_registry:
        return (
            f"{product_ref} is Brand Registered but A+ Content is not active. "
            f"A+ Content is already unlocked for this brand — adding it is a quick win that typically lifts conversion 5–10%."
        )
    if img_count and img_count < 7:
        return (
            f"{product_ref} has {img_count} of 7 recommended images. "
            f"Adding {7 - img_count} more optimized image{'s' if 7 - img_count > 1 else ''} (lifestyle, infographic, size chart) "
            f"can meaningfully improve click-through rate."
        )

    # Well-optimized listing — summarize what was verified
    strengths = []
    if has_a_plus:
        strengths.append("A+ Content active")
    if brand_registry:
        strengths.append("Brand Registry enrolled")
    if img_count >= 7:
        strengths.append(f"{img_count} listing images")
    if rating >= 4.3:
        strengths.append(f"{rating}★ rating across {reviews:,} reviews")
    elif rating >= 4.0:
        strengths.append(f"{rating}★ rating")
    if price:
        strengths.append(f"priced at {price}")

    if strengths:
        return f"{product_ref} is well-optimised — {', '.join(strengths)}. The biggest growth levers are likely PPC structure and keyword targeting."
    return f"Listing data verified for {product_ref}. Review the scorecard above for optimisation opportunities."


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
        "Use ONLY real data explicitly found in the search results. "
        "If a data point cannot be confirmed from the search results, set it to null — do NOT guess or estimate.\n\n"
        "Return ONLY a JSON object with these keys:\n"
        "{\n"
        '  "brand_name": "The brand/store name or null",\n'
        '  "niche": "The product category/niche or null",\n'
        '  "top_listing": { "asin": "B0XXXXXXXX or null", "title": "Product title or null" },\n'
        '  "image_count": null,\n'
        '  "image_benchmark": 7,\n'
        '  "a_plus_content": null,\n'
        '  "brand_registry": null,\n'
        '  "review_count": null,\n'
        '  "avg_rating": null,\n'
        '  "category": "Product category or null",\n'
        '  "category_avg_rating": null,\n'
        '  "price_range": "$XX - $YY or null",\n'
        '  "flagged_issue": "One specific, blunt issue based only on found data, or null",\n'
        '  "competitive_summary": "2-3 sentences on how this brand compares to category leaders, or null"\n'
        "}\n\n"
        "IMPORTANT: Only populate numeric fields (image_count, review_count, avg_rating, category_avg_rating) "
        "if you found the exact number in the search results. Otherwise use null."
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
    image_count = raw.get("image_count")   # None = unknown
    image_bench = raw.get("image_benchmark", 7)
    avg_rating = raw.get("avg_rating")     # None = unknown
    cat_avg = raw.get("category_avg_rating")  # None = unknown
    review_count = raw.get("review_count") # None = unknown
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
        "count": image_count,  # None = no data found
        "benchmark": image_bench,
        "status": _status(
            image_count is not None and image_count >= image_bench,
            image_count is not None and image_count >= image_bench - 2,
        ) if image_count is not None else "unknown",
    }
    if raw.get("image_urls"):
        image_data["imageUrls"] = raw["image_urls"][:9]

    # A+ content with proof
    a_plus_raw = raw.get("a_plus_content")
    a_plus_data = {
        "present": bool(a_plus_raw) if a_plus_raw is not None else None,
        "status": ("good" if a_plus_raw else "critical") if a_plus_raw is not None else "unknown",
    }
    if raw.get("a_plus_proof_url"):
        a_plus_data["proofUrl"] = raw["a_plus_proof_url"]

    # Brand registry with evidence
    brand_raw = raw.get("brand_registry")
    brand_reg_data = {
        "detected": bool(brand_raw) if brand_raw is not None else None,
        "status": ("good" if brand_raw else "warning") if brand_raw is not None else "unknown",
        "dataSource": data_source,  # expose source so UI can show "Unverified" for perplexity
    }
    if raw.get("brand_registry_evidence"):
        brand_reg_data["evidence"] = raw["brand_registry_evidence"]
    if raw.get("brand_name"):
        brand_reg_data["brandName"] = raw["brand_name"]

    # Reviews with distribution
    review_data = {
        "rating": avg_rating,       # None = not found
        "reviewCount": review_count, # None = not found
        "categoryAvg": cat_avg,     # None = not found
        "status": _status(
            avg_rating is not None and cat_avg is not None and avg_rating >= cat_avg,
            avg_rating is not None and cat_avg is not None and avg_rating >= cat_avg - 0.3,
        ) if avg_rating is not None else "unknown",
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


def _build_summary_bullets(raw: dict, listing_health: dict) -> dict:
    """
    Build 3 specific, data-driven summary bullets. Each sentence must reference
    real numbers and product names — never fall back to generic filler text.
    """
    brand = raw.get("brand_name", "This brand")
    rating = raw.get("avg_rating") or 0
    reviews = raw.get("review_count") or 0
    has_a_plus = raw.get("a_plus_content") or False
    img_count = raw.get("image_count") or 0
    brand_registry = raw.get("brand_registry") or False
    price_range = raw.get("price_range", "")
    best_sellers = raw.get("best_sellers") or []
    lowest_sellers = raw.get("lowest_sellers") or []

    # Pull real numbers from product lists
    best_reviews = [int(p.get("reviews", 0) or 0) for p in best_sellers]
    low_reviews  = [int(p.get("reviews", 0) or 0) for p in lowest_sellers]
    top_reviews  = max(best_reviews) if best_reviews else 0
    low_max      = max(low_reviews) if low_reviews else 0
    low_min      = min(low_reviews) if low_reviews else 0
    top_product  = best_sellers[0].get("title", "") if best_sellers else ""
    top_short    = top_product.split(",")[0].split("|")[0].split("-")[0].strip()[:55] if top_product else ""
    low_product  = lowest_sellers[-1].get("title", "") if lowest_sellers else ""
    low_short    = low_product.split(",")[0].split("|")[0].split("-")[0].strip()[:55] if low_product else ""
    total_catalog = len(best_sellers) + len(lowest_sellers)
    review_gap   = top_reviews - low_max if top_reviews and low_max else 0

    # ── Strongest Points ──────────────────────────────────────────────────
    parts = []
    if top_reviews >= 100:
        parts.append(f'"{top_short}" leads the catalog with {top_reviews:,} reviews at {rating}★')
    if has_a_plus and brand_registry:
        parts.append("A+ Content and Brand Registry are both active, giving strong content and brand protection")
    elif has_a_plus:
        parts.append("A+ Content is live, boosting conversion on the flagship listing")
    if img_count >= 7:
        parts.append(f"the main listing hits the {img_count}-image benchmark")
    if price_range:
        parts.append(f"the catalog spans {price_range}, covering multiple price points")
    if total_catalog >= 4:
        parts.append(f"{total_catalog} distinct products across the storefront")

    if len(parts) >= 2:
        strongest = f"{brand}'s biggest asset is that {parts[0]}, and {parts[1]}."
    elif len(parts) == 1:
        strongest = f"{brand}'s standout strength: {parts[0]}."
    else:
        strongest = f"{brand} has an active Amazon presence with products indexed and ready to scale."

    # ── Areas of Improvement ──────────────────────────────────────────────
    gaps = []

    if not has_a_plus:
        gaps.append("A+ Content is missing — this alone can lift conversion rates 5–10% with no ad spend required")
    if not brand_registry:
        gaps.append("Brand Registry is not active — without it, A+ Content, Sponsored Brands ads, and brand protection are all locked out")
    if img_count and img_count < 7:
        gaps.append(f"the main listing has only {img_count} images vs. Amazon's 7-image recommendation — adding lifestyle and infographic shots is a quick win")

    if review_gap > 200 and low_short:
        gaps.append(
            f'"{low_short}" has only {low_max:,} reviews vs. {top_reviews:,} on the top product — '
            f"a {review_gap:,}-review gap that signals low visibility in search for that listing"
        )
    elif low_min == 0 and low_short:
        gaps.append(f'"{low_short}" has 0 reviews — it is essentially invisible in Amazon search and needs an immediate launch push')
    elif low_max and low_max < 30:
        gaps.append(
            f"the lowest performers have fewer than {low_max} reviews each — they are not ranking and are likely losing the buy box to competitors"
        )

    if reviews and reviews < 100:
        gaps.append(f"overall review volume is thin at {reviews} — below 100 reviews hurts organic ranking across the board")

    if not gaps:
        # Well-optimized brand — point to PPC and catalog depth as the next lever
        if top_reviews and low_max and review_gap > 100:
            gaps.append(
                f"the review spread between the top product ({top_reviews:,}) and the lower performers ({low_max:,}) "
                f"suggests uneven PPC investment — the lower listings need dedicated ad budgets to close the gap"
            )
        else:
            gaps.append(
                f"keyword targeting and PPC structure are the highest-leverage levers left — "
                f"even small improvements in ACoS on a {top_reviews:,}-review listing translate to meaningful monthly revenue"
            )

    if len(gaps) >= 2:
        improvement = f"{gaps[0].capitalize()}. On top of that, {gaps[1]}."
    else:
        improvement = gaps[0].capitalize() + "."

    # ── Revlyn Help ───────────────────────────────────────────────────────
    actions = []
    if not has_a_plus or not brand_registry:
        actions.append("unlock Brand Registry and build A+ Content modules on the top listings")
    if low_min == 0 or low_max < 30:
        actions.append(f"run a targeted launch campaign for the low-review products to get them indexed and ranking")
    elif review_gap > 200:
        actions.append(f"redistribute ad spend to close the {review_gap:,}-review gap between the flagship and the lower listings")
    actions.append(f"build a PPC structure around \"{top_short}\" to defend its ranking and push it into the top 3 search positions")
    if img_count and img_count < 7:
        actions.append("produce additional listing images (lifestyle, infographic, comparison) to hit the 7-image benchmark")

    if len(actions) >= 3:
        revlyn_help = f"Revlyn will {actions[0]}, {actions[1]}, and {actions[2]} — converting these gaps into compounding revenue gains month over month."
    elif len(actions) == 2:
        revlyn_help = f"Revlyn will {actions[0]} and {actions[1]}, turning {brand}'s existing strengths into a scalable growth engine."
    else:
        revlyn_help = f"Revlyn will {actions[0]}, giving {brand} a clear path to higher rankings and revenue."

    return {
        "strongest_points": strongest,
        "areas_of_improvement": improvement,
        "revlyn_help": revlyn_help,
    }


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

    # Detect bare /stores/page/UUID URLs that have no brand slug and no seed ASIN.
    # These have no identifiable brand info — we can't look up products without a brand name.
    from app.services.rainforest import _normalize_store_url, _extract_lp_asin, _is_storefront_url
    if _is_storefront_url(req.store_url) and not _normalize_store_url(req.store_url) and not _extract_lp_asin(req.store_url) and not brand_hint:
        raise HTTPException(
            400,
            "This URL doesn't contain a brand name or product ID. Please also enter the Brand Name field so we can look up the correct store."
        )

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
            "summary_bullets": _build_summary_bullets(raw_scorecard, listing_health),
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
        "brand_analysis": audit_data["brand_analysis"],
    }
