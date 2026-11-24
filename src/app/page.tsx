import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Reads the session on the server. This uses request headers (dynamic data),
 * so with Cache Components enabled it must live inside a <Suspense> boundary.
 */
async function AuthActions() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return (
      <Button asChild size="lg">
        <Link href="/auth/login">Sign In / Sign Up</Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">
        Signed in as{" "}
        <span className="font-medium text-foreground">
          {session.user.name || session.user.email}
        </span>
      </p>
      <SignOutButton />
      
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <Suspense fallback={<div className="h-11" />}>
        <AuthActions />
      </Suspense>
    </div>
  );
}