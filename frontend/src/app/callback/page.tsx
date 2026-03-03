"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { userManager } from "@/lib/userManager";
import { saveTokens } from "@/lib/auth";

export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    userManager
      .signinCallback()
      .then((user) => {
        if (!user) {
          setError("Sign-in failed: no user returned.");
          return;
        }
        saveTokens({
          access_token: user.access_token,
          id_token: user.id_token ?? "",
          refresh_token: user.refresh_token ?? "",
          expires_in: user.expires_in ?? 3600,
        });
        router.replace("/");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Authentication failed.");
      });
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-6 py-4 text-red-300 max-w-md">
          <p className="font-semibold mb-1">Sign-in error</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-slate-400">Completing sign-in…</p>
    </div>
  );
}
