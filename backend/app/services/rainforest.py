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


def _is_storefront_url(url: str) -> bool:
    """Returns True if the URL is an Amazon storefront (/stores/) page."""
    path = urlparse(url.strip()).path.strip("/")
    return path.lower().startswith("stores")


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

    # Strategy 1: seller_products by seller ID (only for /sp?seller= style URLs)
    if seller_id:
        try:
            products = await _seller_products(client, seller_id, amazon_domain)
            if products:
                print(f"[rainforest] seller_products(id={seller_id}) -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] seller_products(id) failed: {e}")

    # Strategy 2: for /stores/ URLs, use Rainforest type=store to get storefront products
    if _is_storefront_url(store_url):
        try:
            products = await _store_page_products(client, store_url)
            if products:
                print(f"[rainforest] store_page -> {len(products)} products")
                return products
        except Exception as e:
            print(f"[rainforest] store_page failed: {e}")

    # Strategy 3: pass the full URL directly as seller_products
    try:
        products = await _seller_products_by_url(client, store_url)
        if products:
            print(f"[rainforest] seller_products(url) -> {len(products)} products")
            return products
    except Exception as e:
        print(f"[rainforest] seller_products(url) failed: {e}")

    return []


async def _store_page_products(
    client: httpx.AsyncClient,
    store_url: str,
) -> list[dict]:
    """
    Fetch products from an Amazon storefront page (/stores/ URLs).
    Uses Rainforest type=store which is designed for Amazon Brand Stores.
    Falls back to parsing the store page as a search result set.
    """
    # Rainforest type=store returns store_results with asin+link only (no title/price/rating)
    # We collect unique ASINs, then the caller fetches product details separately
    try:
        resp = await client.get(BASE_URL, params={
            "api_key": _api_key(),
            "type": "store",
            "url": store_url,
        })
        resp.raise_for_status()
        data = resp.json()
        store_results = data.get("store_results", [])
        print(f"[rainforest] type=store: {len(store_results)} store_results")

        # Deduplicate ASINs while preserving order
        seen = set()
        asin_stubs = []
        for r in store_results:
            asin = r.get("asin", "")
            if asin and asin not in seen:
                seen.add(asin)
                asin_stubs.append({
                    "asin": asin,
                    "title": "",   # Will be filled by product detail call
                    "price": "",
                    "rating": 0,
                    "reviews": 0,
                    "image": "",
                    "link": r.get("link", ""),
                })
        if asin_stubs:
            print(f"[rainforest] type=store: {len(asin_stubs)} unique ASINs")
            return asin_stubs
    except Exception as e:
        print(f"[rainforest] type=store failed: {type(e).__name__}: {e}")

    return []


async def _seller_products(
    client: httpx.AsyncClient,
    seller_id: str,
    amazon_domain: str,
) -> list[dict]:
    """Fetch seller's product listings via Rainforest seller_products."""
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "seller_products",
        "seller_id": seller_id,
        "amazon_domain": amazon_domain,
    })
    resp.raise_for_status()
    data = resp.json()
    return _parse_seller_products(data)


async def _seller_products_by_url(
    client: httpx.AsyncClient,
    url: str,
) -> list[dict]:
    """Fetch seller's products by passing the store URL directly."""
    resp = await client.get(BASE_URL, params={
        "api_key": _api_key(),
        "type": "seller_products",
        "url": url,
    })
    resp.raise_for_status()
    data = resp.json()
    return _parse_seller_products(data)



def _parse_seller_products(data: dict) -> list[dict]:
    """Parse seller_products response into a normalized product list."""
    results = data.get("seller_products", [])
    return [
        {
            "asin": r.get("asin", ""),
            "title": r.get("title", ""),
            "price": r.get("price", {}).get("raw", "") if isinstance(r.get("price"), dict) else str(r.get("price", "")),
            "rating": r.get("rating", 0),
            "reviews": r.get("ratings_total", 0),
            "image": r.get("image", "") or r.get("thumbnail", ""),
            "link": r.get("link", ""),
        }
        for r in results[:20]  # Up to 20 products to get meaningful best/lowest split
        if r.get("asin")
    ]


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
    star_map = {"five_star": 5, "four_star": 4, "three_star": 3, "two_star": 2, "one_star": 1}
    for key, star_num in star_map.items():
        if key in rb:
            rating_distribution[star_num] = rb[key].get("percentage", 0)

    # Parse price
    price_obj = product.get("price", {})
    price_str = price_obj.get("raw", "") if isinstance(price_obj, dict) else str(price_obj or "")

    return {
        "asin": product.get("asin", asin),
        "title": product.get("title", ""),
        "brand": product.get("brand", ""),
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
    max_concurrent: int = 6,
) -> list[dict]:
    """Fetch product details for multiple ASINs in parallel."""
    asins = asins[:max_concurrent]
    tasks = [get_product_details(client, asin, amazon_domain) for asin in asins]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if isinstance(r, dict)]
