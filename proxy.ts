import { auth } from "@/auth";

/**
 * Proxy runs on every request to keep the JWT session cookie fresh.
 * No routes are protected — the app works in guest mode without a session.
 * Skip static assets and the NextAuth API route itself.
 */
export const proxy = auth;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth).*)",
  ],
};
