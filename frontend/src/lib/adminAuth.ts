const ADMIN_TOKEN_KEY = "admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function adminFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAdminToken();
  if (!token) throw new Error("Not authenticated as admin");
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    signal: init.signal ?? AbortSignal.timeout(120_000),
  });
}
