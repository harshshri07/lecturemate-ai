import { NextRequest, NextResponse } from "next/server";

// In-memory store for rate limiting (resets on server restart)
// For production, use a database like Redis or Supabase
const guestRateLimitStore = new Map<string, { count: number; resetTime: number }>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === "check") {
      // Get client IP
      const ip = getClientIp(request);

      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Get or create rate limit entry for this IP
      let entry = guestRateLimitStore.get(ip);

      // Reset if 24 hours have passed
      if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + oneDayMs };
        guestRateLimitStore.set(ip, entry);
      }

      // Check if limit reached (1 URL per day for guests)
      const limit = 1;
      const remaining = Math.max(0, limit - entry.count);
      const allowed = entry.count < limit;

      return NextResponse.json({
        allowed,
        remaining,
        count: entry.count,
        ip, // For debugging
      });
    }

    if (action === "increment") {
      // Get client IP
      const ip = getClientIp(request);

      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      let entry = guestRateLimitStore.get(ip);

      // Reset if 24 hours have passed
      if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + oneDayMs };
      }

      // Increment count
      entry.count++;
      guestRateLimitStore.set(ip, entry);

      return NextResponse.json({
        count: entry.count,
        remaining: Math.max(0, 1 - entry.count),
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Rate limit error:", error);
    return NextResponse.json(
      { error: "Rate limit check failed" },
      { status: 500 }
    );
  }
}
