"""
Rainforest API service — real-time Amazon product data.

Provides ASIN discovery from store URLs and detailed product info
(images, A+ content, brand registry, reviews, ratings).
"""
import asyncio
import re
from urllib.parse import urlparse, parse_qs

import httpx

from app.core.config import settings

BASE_URL = "https://api.rainforestapi.com/request"


def _api_key() -> str:
    key = settings.RAINFOREST_API_KEY
    if not key:
        raise RuntimeError("RAINFOREST_API_KEY not configured")
    return key


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _is_uuid(s: str) -> bool:
    return bool(_UUID_RE.match(s))


def extract_seller_id_from_url(url: str) -> str:
    """
    Extract Amazon seller ID from various store URL formats.
    Returns empty string for storefront page URLs (which use UUID page IDs,
    not seller IDs) — those must be looked up by URL directly.
    """
    parsed = urlparse(url.strip())
    path = parsed.path.strip("/")
    segments = [s for s in path.split("/") if s]
    qs = parse_qs(parsed.query)

    # /sp?seller=XXXXX or /sp?me=XXXXX — real seller IDs
    if segments and segments[0].lower() == "sp":
        seller = qs.get("seller", qs.get("me", [""]))[0]
        if seller and not _is_uuid(seller):
            return seller

    # /stores/page/XXXXXXX or /stores/Brand/page/XXXXXXX
    # These are storefront page IDs (UUIDs), NOT seller IDs — skip them
    if segments and segments[0].lower() == "stores":
        return ""

    # ?me=XXXXX anywhere (real seller ID, not UUID)
    me = qs.get("me", [""])[0]
    if me and not _is_uuid(me):
        return me

    return ""


def extract_amazon_domain(url: str) -> str:
    """Extract amazon domain from URL (e.g. amazon.com, amazon.co.uk)."""
    parsed = urlparse(url.strip())
    host = parsed.hostname or ""
    # Match amazon.XX or amazon.co.XX
    m = re.search(r"(amazon\.\w+(?:\.\w+)?)", host)
    return m.group(1) if m else "amazon.com"


def _looks_like_seller_id(s: str) -> bool:
    """Returns True if the string looks like an Amazon seller ID (all caps/digits, no spaces, short)."""
    s = s.strip()
    return bool(s and len(s) <= 14 and s.replace("-", "").isupper() and " " not in s)


def _is_storefront_url(url: str) -> bool:
    """Returns True if the URL is an Amazon storefront (/stores/) page."""
    path = urlparse(url.strip()).path.strip("/")
    return path.lower().startswith("stores")


def _normalize_store_url(url: str) -> str:
    """
    Normalize a store URL to its base storefront.
    /stores/BRAND/page/UUID?params... → /stores/BRAND
    /stores/page/UUID?params...       → "" (no brand slug, can't normalize)
    This ensures Rainforest type=store returns all products, not just one sub-page.
    Returns empty string when the URL has no usable brand slug.
    """
    parsed = urlparse(url.strip())
    segments = [s for s in parsed.path.strip("/").split("/") if s]
    # segments: ['stores', 'BRAND', 'page', 'UUID'] — BRAND must not be 'page' or a UUID
    if len(segments) >= 2 and segments[0].lower() == "stores":
        brand = segments[1]
        if brand.lower() != "page" and not _is_uuid(brand):
            base_path = f"/{segments[0]}/{brand}"
            return f"{parsed.scheme}://{parsed.netloc}{base_path}"
    return ""


def _extract_lp_asin(url: str) -> str:
    """Extract seed ASIN from store page URLs.
    Checks lp_asin first (FERUERW-style), then lp_context_asin (Ollny-style).
    Only returns values that look like ASINs (start with B0 or are 10 alphanumeric chars).
    """
    qs = parse_qs(urlparse(url.strip()).query)
    for key in ("lp_asin", "lp_context_asin"):
        val = qs.get(key, [""])[0]
        if val and re.match(r"^[A-Z0-9]{10}$", val):
            return val
    return ""


def _extract_store_slug(url: str) -> str:
    """Extract raw brand slug from /stores/BRAND/ URL (exact case, no .title() transform)."""
    parsed = urlparse(url.strip())
    segments = [s for s in parsed.path.strip("/").split("/") if s]
    if len(segments) >= 2 and segments[0].lower() == "stores":
        candidate = segments[1]
        if candidate.lower() != "page" and not _is_uuid(candidate):
            return candidate
    return ""


async def discover_asins(
    client: httpx.AsyncClient,
    store_url: str,
    brand_hint: str,
    amazon_domain: str = "amazon.com",
) -> list[dict]:
    """
    Discover ASINs from an Amazon store URL — only fetches products
    belonging to that specific seller. Never uses brand name search
    (which would return competitor products).
    """
    seller_id = extract_seller_id_from_url(store_url)
    lp_asin = _extract_lp_asin(store_url)  # fast-path seed when present

    # Strategy 1: seller_products by seller ID (only for /sp?seller= style URLs)
    if seller_id:
        try:
            products = await _seller_products(client, seller_id, amazon_domain)
            if products:
                print(f"[rainforest] seller_products(id={seller_id}) -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] seller_products(id) failed: {e}")

    # Strategy 2: for /stores/ URLs, normalize to base store URL then fetch storefront products.
    # Skip entirely if:
    #   - normalized URL is empty (no brand slug — e.g. /stores/page/UUID), OR
    #   - lp_asin is present (Strategy 4 is faster and more reliable for those URLs)
    if _is_storefront_url(store_url) and not lp_asin:
        normalized = _normalize_store_url(store_url)
        print(f"[rainforest] normalized store URL: {normalized!r}")
        if normalized:
            try:
                products = await _store_page_products(client, normalized)
                if products:
                    print(f"[rainforest] store_page(normalized) -> {len(products)} products")
                    return products
            except Exception as e:
                print(f"[rainforest] store_page(normalized) failed: {e}")

            # Strategy 2b: also try the original URL in case normalization hurt
            if normalized != store_url:
                try:
                    products = await _store_page_products(client, store_url)
                    if products:
                        print(f"[rainforest] store_page(original) -> {len(products)} products")
                        return products
                except Exception as e:
                    print(f"[rainforest] store_page(original) failed: {e}")

        # Strategy 2c: try the store slug as a seller_id
        slug = _extract_store_slug(store_url)
        if slug:
            try:
                products = await _seller_products(client, slug, amazon_domain)
                if products:
                    print(f"[rainforest] seller_products(slug={slug!r}) -> {len(products)} products")
                    return products
            except Exception as e:
                print(f"[rainforest] seller_products(slug={slug!r}) failed: {e}")

        # Strategy 3: pass the full URL directly as seller_products
        try:
            products = await _seller_products_by_url(client, store_url)
            if products:
                print(f"[rainforest] seller_products(url) -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] seller_products(url) failed: {e}")

    elif not lp_asin:
        # Strategy 3 for non-storefront URLs without lp_asin
        try:
            products = await _seller_products_by_url(client, store_url)
            if products:
                print(f"[rainforest] seller_products(url) -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] seller_products(url) failed: {e}")

    # Strategy 4: lp_asin seed — fetch that product, then use its brand to find more
    if lp_asin:
        print(f"[rainforest] using lp_asin seed: {lp_asin}")
        try:
            details = await get_product_details(client, lp_asin, amazon_domain)
            if details.get("asin"):
                seed = {
                    "asin": details["asin"],
                    "title": details.get("title", ""),
                    "brand": details.get("brand", ""),
                    "price": details.get("price", ""),
                    "rating": details.get("rating", 0),
                    "reviews": details.get("ratings_total", 0),
                    "image": details.get("main_image", ""),
                    "link": details.get("link", ""),
                }
                # Strategy 4b: use the brand from that product to find sibling products.
                # Build an ordered list of search candidates and try each until we get > 1 result.
                # Always try the raw detail_brand first — even if it looks like a seller ID code
                # (e.g. "FERUERW"), because Amazon stores products with brand='FERUERW' and
                # brand_search on that code will find them.
                detail_brand = details.get("brand", "")
                print(f"[rainforest] lp_asin detail brand={detail_brand!r} title={details.get('title', '')[:50]!r}")

                search_candidates: list[str] = []
                # 1. User-supplied brand_hint takes top priority when it's a readable brand name.
                #    This prevents the lp_asin's brand (e.g. "Melissa & Doug" on a Tiny Land store
                #    page) from overriding what the user explicitly told us.
                if brand_hint and not _looks_like_seller_id(brand_hint):
                    search_candidates.append(brand_hint)
                # 2. Raw slug from the store URL (e.g. "TinyLand" from /stores/TinyLand/page/...)
                store_slug = _extract_store_slug(store_url)
                if store_slug and not any(store_slug.lower() == c.lower() for c in search_candidates):
                    search_candidates.append(store_slug)
                # 3. Brand from the lp_asin product details — only add if it matches the brand_hint
                #    or store slug (i.e. it's genuinely this brand, not a co-sold product).
                if detail_brand:
                    slug_lower = store_slug.lower() if store_slug else ""
                    hint_lower = brand_hint.lower() if brand_hint else ""
                    brand_matches_store = (
                        detail_brand.lower() == hint_lower
                        or detail_brand.lower() == slug_lower
                        or (hint_lower and hint_lower in detail_brand.lower())
                        or (hint_lower and detail_brand.lower() in hint_lower)
                    )
                    if brand_matches_store or not search_candidates:
                        if not any(detail_brand.lower() == c.lower() for c in search_candidates):
                            search_candidates.append(detail_brand)
                # 4. Title keywords as last resort (only when brand looks like a seller ID code)
                if detail_brand and _looks_like_seller_id(detail_brand):
                    title_words = [
                        w for w in details.get("title", "").split()
                        if len(w) > 3 and not _looks_like_seller_id(w)
                    ]
                    if title_words:
                        search_candidates.append(" ".join(title_words[:3]))

                best_brand_products: list[dict] = []
                for candidate in search_candidates:
                    if not candidate:
                        continue
                    try:
                        brand_products = await brand_search(client, candidate, amazon_domain, max_pages=5)
                        print(f"[rainforest] brand_search({candidate!r}) -> {len(brand_products)} products")
                        if len(brand_products) > len(best_brand_products):
                            best_brand_products = brand_products
                        if len(best_brand_products) >= 3:
                            break  # Good enough — stop trying candidates
                    except Exception as e:
                        print(f"[rainforest] brand_search({candidate!r}) failed: {e}")

                if best_brand_products:
                    return best_brand_products
                # Fall back to just the seed product
                return [seed]
        except Exception as e:
            print(f"[rainforest] lp_asin product detail failed: {e}")

    # Strategy 5: brand_hint fallback — for URLs with no slug and no lp_asin
    # (e.g. /stores/page/UUID with no query params)
    if brand_hint and not _looks_like_seller_id(brand_hint):
        print(f"[rainforest] Strategy 5: brand_hint fallback search for {brand_hint!r}")
        try:
            products = await brand_search(client, brand_hint, amazon_domain, max_pages=5)
            if products:
                print(f"[rainforest] brand_hint fallback -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] brand_hint fallback failed: {e}")

    return []


async def brand_search(
    client: httpx.AsyncClient,
    brand_name: str,
    amazon_domain: str = "amazon.com",
    max_pages: int = 5,
) -> list[dict]:
    """
    Search Amazon for products by brand name, pulling up to max_pages in one API call.
    Returns brand-matched results only; falls back to unfiltered results for seller-code brands.
    """
    brand_lower = brand_name.lower()

    def _filter(results: list) -> list:
        return [
            r for r in results
            if brand_lower in (r.get("brand", "") or "").lower()
            or brand_lower in (r.get("title", "") or "").lower()
        ]

    def _normalize(r: dict) -> dict:
        # Search results use main_image (not image/thumbnail)
        image = r.get("main_image", "") or r.get("image", "") or r.get("thumbnail", "")
        # Price can live in multiple places depending on search result type:
        # - buybox_winner.price.raw (standard search)
        # - price.raw (some search variants)
        # - price as a plain string (brand-facet results)
        price_raw = ""
        buybox = r.get("buybox_winner", {})
        if isinstance(buybox, dict):
            price_obj = buybox.get("price", {})
            price_raw = price_obj.get("raw", "") if isinstance(price_obj, dict) else str(price_obj or "")
        if not price_raw:
            price_obj = r.get("price", {})
            if isinstance(price_obj, dict):
                price_raw = price_obj.get("raw", "") or price_obj.get("value", "") or price_obj.get("current_price", "")
            elif isinstance(price_obj, (int, float)):
                price_raw = f"${price_obj:.2f}"
            elif isinstance(price_obj, str) and price_obj:
                price_raw = price_obj
        if not price_raw:
            # Last resort: check typical_price field
            typical = r.get("typical_price_saves", {})
            if isinstance(typical, dict):
                price_raw = typical.get("price", {}).get("raw", "") if isinstance(typical.get("price"), dict) else ""
        if not price_raw:
            print(f"[rainforest] _normalize: no price found for {r.get('asin','')} — keys={list(r.keys())}")
        return {
            "asin": r.get("asin", ""),
            "title": r.get("title", ""),
            "price": price_raw,
            "rating": r.get("rating", 0),
            "reviews": r.get("ratings_total", 0),
            "image": image,
            "link": r.get("link", ""),
        }

    # First try: Amazon's native brand facet filter (1 call for most brands)
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "search",
        "search_term": brand_name,
        "amazon_domain": amazon_domain,
        "sort_by": "featured",
        "max_page": str(max_pages),
        "brand": brand_name,
    })
    resp.raise_for_status()
    all_results = resp.json().get("search_results", [])
    filtered = [r for r in all_results if r.get("asin")]
    print(f"[rainforest] brand_search({brand_name!r}) brand-facet={len(filtered)}")

    # Only fire a second call if brand-facet returned too few results
    if len(filtered) < 3:
        resp2 = await client.get(BASE_URL, params={
            "api_key": _api_key(),
            "type": "search",
            "search_term": brand_name,
            "amazon_domain": amazon_domain,
            "sort_by": "featured",
            "max_page": str(max_pages),
        })
        resp2.raise_for_status()
        all_results2 = resp2.json().get("search_results", [])
        filtered2 = _filter(all_results2)
        print(f"[rainforest] brand_search({brand_name!r}) unfiltered fallback={len(filtered2)}")
        if len(filtered2) > len(filtered):
            filtered = filtered2
        # For seller-ID-code brands with no filter match, use raw top results
        if not filtered and _looks_like_seller_id(brand_name):
            filtered = [r for r in all_results2 if r.get("asin")]

    products = filtered[:20]
    return [_normalize(r) for r in products if r.get("asin")]


async def _store_page_products(
    client: httpx.AsyncClient,
    store_url: str,
    max_page: int = 5,
) -> list[dict]:
    """
    Fetch ALL products from an Amazon storefront in one request using max_page.
    type=store returns full product data (title, image, rating, ratings_total, price)
    so no secondary detail calls are needed for ranking.
    """
    try:
        resp = await client.get(BASE_URL, params={
            "api_key": _api_key(),
            "type": "store",
            "url": store_url,
            "max_page": str(max_page),
        })
        resp.raise_for_status()
        data = resp.json()
        store_results = data.get("store_results", [])
        print(f"[rainforest] type=store max_page={max_page}: {len(store_results)} store_results")

        seen: set[str] = set()
        products = []
        for r in store_results:
            asin = r.get("asin", "")
            if not asin or asin in seen:
                continue
            seen.add(asin)
            price_obj = r.get("price", {})
            price_raw = price_obj.get("raw", "") if isinstance(price_obj, dict) else str(price_obj or "")
            image = (
                r.get("image") or r.get("main_image") or r.get("thumbnail") or
                r.get("image_url") or r.get("imageUrl") or ""
            )
            reviews = r.get("ratings_total") or r.get("reviews_count") or r.get("review_count") or 0
            rating = r.get("rating") or r.get("stars") or 0
            if not image or not reviews:
                print(f"[rainforest] sparse store result for {asin}: keys={list(r.keys())}")
            products.append({
                "asin": asin,
                "title": r.get("title", ""),
                "price": price_raw,
                "rating": rating,
                "reviews": reviews,
                "image": image,
                "link": r.get("link", ""),
            })
        if products:
            print(f"[rainforest] type=store: {len(products)} unique products across all pages")
            return products
    except Exception as e:
        print(f"[rainforest] type=store failed: {type(e).__name__}: {e}")

    return []


async def _seller_products(
    client: httpx.AsyncClient,
    seller_id: str,
    amazon_domain: str,
    max_page: int = 5,
) -> list[dict]:
    """Fetch all seller product listings using max_page to paginate in one request."""
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "seller_products",
        "seller_id": seller_id,
        "amazon_domain": amazon_domain,
        "max_page": str(max_page),
    })
    resp.raise_for_status()
    data = resp.json()
    return _parse_seller_products(data)


async def _seller_products_by_url(
    client: httpx.AsyncClient,
    url: str,
    max_page: int = 5,
) -> list[dict]:
    """Fetch all seller products by store URL using max_page to paginate in one request."""
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "seller_products",
        "url": url,
        "max_page": str(max_page),
    })
    resp.raise_for_status()
    data = resp.json()
    return _parse_seller_products(data)


def _parse_seller_products(data: dict) -> list[dict]:
    """Parse seller_products response into a normalized product list."""
    results = data.get("seller_products", [])
    normalized = []
    for r in results:
        if not r.get("asin"):
            continue
        image = r.get("main_image", "") or r.get("image", "") or r.get("thumbnail", "")
        price_obj = r.get("price", {})
        price_raw = price_obj.get("raw", "") if isinstance(price_obj, dict) else str(price_obj or "")
        normalized.append({
            "asin": r.get("asin", ""),
            "title": r.get("title", ""),
            "price": price_raw,
            "rating": r.get("rating", 0),
            "reviews": r.get("ratings_total", 0),
            "image": image,
            "link": r.get("link", ""),
        })
    return normalized


async def get_product_details(
    client: httpx.AsyncClient,
    asin: str,
    amazon_domain: str = "amazon.com",
) -> dict:
    """Fetch detailed product data for a single ASIN."""
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "product",
        "asin": asin,
        "amazon_domain": amazon_domain,
        "include_a_plus_body": "true",
    })
    resp.raise_for_status()
    data = resp.json()
    product = data.get("product", {})

    # Parse images
    images = product.get("images", [])
    image_urls = [img.get("link", "") for img in images if img.get("link")]

    # Parse A+ content
    a_plus = product.get("a_plus_content", {})
    has_a_plus = bool(a_plus and a_plus.get("has_a_plus_content"))

    # Parse rating breakdown
    rb = product.get("rating_breakdown", {})
    rating_distribution = {}
    star_map = {"five_star": "5", "four_star": "4", "three_star": "3", "two_star": "2", "one_star": "1"}
    for key, star_num in star_map.items():
        if key in rb:
            rating_distribution[star_num] = rb[key].get("percentage", 0)

    # Parse price
    price_obj = product.get("price", {})
    price_str = price_obj.get("raw", "") if isinstance(price_obj, dict) else str(price_obj or "")

    return {
        "asin": product.get("asin", asin),
        "title": product.get("title", ""),
        "brand": product.get("brand", "") or product.get("brand_name", ""),
        "link": product.get("link", ""),
        "price": price_str,
        "images": image_urls,
        "image_count": len(image_urls),
        "has_a_plus": has_a_plus,
        "has_brand_story": bool(a_plus and a_plus.get("has_brand_story")),
        "rating": product.get("rating", 0),
        "ratings_total": product.get("ratings_total", 0),
        "rating_distribution": rating_distribution,
        "main_image": image_urls[0] if image_urls else "",
    }


async def batch_product_details(
    client: httpx.AsyncClient,
    asins: list[str],
    amazon_domain: str = "amazon.com",
    max_concurrent: int = 20,
) -> list[dict]:
    """Fetch product details for multiple ASINs in parallel (up to max_concurrent at once).
    Only returns results that have meaningful data (title or main_image populated).
    """
    asins = asins[:max_concurrent]
    tasks = [get_product_details(client, asin, amazon_domain) for asin in asins]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    good = []
    for asin, r in zip(asins, results):
        if not isinstance(r, dict):
            print(f"[rainforest] product detail failed for {asin}: {r}")
            continue
        # Accept if we got a title or an image — otherwise treat as empty/failed
        if r.get("title") or r.get("main_image"):
            good.append(r)
        else:
            print(f"[rainforest] product detail for {asin} returned no title/image — skipping")
    return good
