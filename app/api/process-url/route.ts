import { NextRequest, NextResponse } from "next/server";
import { extractVideoId, fetchTranscript, fetchVideoMetadata, validateYouTubeUrl } from "@/lib/youtube";
import { processTranscript } from "@/lib/agents/combined";
import { buildLectureChunksFromTranscript } from "@/lib/rag/chunkLecture";
import { indexLectureForRag, isRagConfigured } from "@/lib/rag/vectorStore";

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded. You can process 5 videos per hour." }, { status: 429 });
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
    // Fetch metadata + transcript in parallel
    const [metadata, transcript] = await Promise.all([
      fetchVideoMetadata(videoId),
      fetchTranscript(videoId),
    ]);

    if (transcript.length === 0) {
      return NextResponse.json({ error: "No transcript content found for this video." }, { status: 422 });
    }

    const { lecture, studyMaterials } = await processTranscript(transcript, metadata);

    if (isRagConfigured()) {
      try {
        const chunks = buildLectureChunksFromTranscript(transcript, lecture);
        if (chunks.length > 0) {
          await indexLectureForRag(videoId, chunks);
        }
      } catch (err) {
        console.error("[process-url] RAG indexing failed:", err);
      }
    }

    return NextResponse.json({
      videoId,
      metadata,
      lecture,
      studyMaterials,
      transcript,
    });
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
