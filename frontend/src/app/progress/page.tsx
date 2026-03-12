"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Progress tracking is now admin-only. Redirect regular users to dashboard.
export default function ProgressRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
