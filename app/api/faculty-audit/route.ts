import { NextRequest, NextResponse } from "next/server";
import { extractVideoId, fetchTranscript, fetchVideoMetadata, validateYouTubeUrl } from "@/lib/youtube";
import { generateFacultyAudit } from "@/lib/agents/facultyAudit";

export const maxDuration = 90;

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, maxPerHour: number): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= maxPerHour) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";

  if (!checkRateLimit(`faculty:${ip}`, 5)) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again in an hour." }, { status: 429 });
  }

  let url: string;
  try {
    const body = await req.json();
    url = body.url;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateYouTubeUrl(url);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const videoId = extractVideoId(url)!;

  try {
    const [metadata, transcript] = await Promise.all([
      fetchVideoMetadata(videoId),
      fetchTranscript(videoId),
    ]);

    if (transcript.length === 0) {
      return NextResponse.json({ error: "No transcript content found for this video." }, { status: 422 });
    }

    const report = await generateFacultyAudit(transcript, metadata);

    return NextResponse.json({ videoId, metadata, report });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    const status =
      message.includes("private") || message.includes("unavailable") ? 422
      : message.includes("captions") || message.includes("transcript") ? 422
      : message.includes("timed out") ? 504
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
