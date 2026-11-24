"use client";

import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function AuthRefresh() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const wasAuthenticated = useRef(false);

  useEffect(() => {
    if (isPending) return;

    if (session && !wasAuthenticated.current) {
      wasAuthenticated.current = true;
      router.refresh();
    }

    if (!session) {
      wasAuthenticated.current = false;
    }
  }, [session, isPending, router]);

  return null;
}