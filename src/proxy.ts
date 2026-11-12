import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Next.js 16 "proxy" (the new name for middleware).
 * Runs before /auth/login renders. If the user already has a valid session,
 * send them to the home page instead.
 *
 * The session is validated with Better Auth (not just "a cookie exists"),
 * so an expired or stale cookie does not lock anyone out of the login page.
 */
export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Only run on the login route. Add "/auth/signup" etc. if you create them.
  matcher: ["/auth/login"],
};