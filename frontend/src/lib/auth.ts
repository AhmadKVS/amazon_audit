const STORE_URL_KEY = "store_url";

export function getStoreUrl(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORE_URL_KEY) ?? "";
}

export function setStoreUrl(url: string) {
  localStorage.setItem(STORE_URL_KEY, url.trim());
}

/**
 * fetch() wrapper that attaches the X-Store-URL header for user identification.
 * Drop-in replacement for the old token-based fetchWithAuth.
 */
export async function fetchWithAuth(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const storeUrl = getStoreUrl();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(storeUrl ? { "X-Store-URL": storeUrl } : {}),
    },
    signal: init.signal ?? AbortSignal.timeout(120_000),
  });
}
