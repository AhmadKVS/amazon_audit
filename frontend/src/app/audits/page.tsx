"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Audits list is now admin-only. Redirect regular users to dashboard.
export default function AllAuditsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
