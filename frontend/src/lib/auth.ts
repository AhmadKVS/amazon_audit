const AUTH_KEY = "amazon_audit_tokens";

export interface AuthTokens {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_at: number; // ms timestamp
}

export function saveTokens(tokens: Omit<AuthTokens, "expires_at"> & { expires_in: number }) {
  const data: AuthTokens = {
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

export function getTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const tokens = JSON.parse(raw) as AuthTokens;
    // Treat as expired 60 seconds early to avoid race conditions
    if (Date.now() > tokens.expires_at - 60_000) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return tokens;
  } catch {
    return null;
  }
}

export function clearTokens() {
  localStorage.removeItem(AUTH_KEY);
}

export function isAuthenticated(): boolean {
  return getTokens() !== null;
}

export function getAccessToken(): string | null {
  return getTokens()?.access_token ?? null;
}

/** Attempt to refresh the access token using the stored refresh token. */
export async function refreshTokens(): Promise<boolean> {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as AuthTokens;
    if (!parsed.refresh_token) return false;
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: parsed.refresh_token }),
    });
    if (!res.ok) { clearTokens(); return false; }
    const data = await res.json();
    saveTokens(data);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

/** fetch() wrapper that automatically attaches the Bearer token, refreshing if expired. */
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();

  // Token is expired/missing — try to refresh once before giving up
  if (!token) {
    const refreshed = await refreshTokens();
    if (refreshed) token = getAccessToken();
  }

  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** Sign out: revoke server-side + clear local tokens */
export async function signOut() {
  const token = getAccessToken();
  if (token) {
    try {
      await fetch(`/api/auth/signout?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
      });
    } catch {
      // If revocation fails, still clear locally
    }
  }
  clearTokens();
}
