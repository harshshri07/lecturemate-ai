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
  console.log(`[process-url] ▶ videoId=${videoId} ip=${ip}`);

  try {
    console.log(`[process-url] fetching metadata + transcript in parallel…`);
    const t0 = Date.now();

    const [metadata, transcript] = await Promise.all([
      fetchVideoMetadata(videoId).then((m) => {
        console.log(`[process-url] metadata OK  title="${m.title}" channel="${m.channelName}" duration=${m.duration}s  (${Date.now() - t0}ms)`);
        return m;
      }),
      fetchTranscript(videoId).then((t) => {
        console.log(`[process-url] transcript OK  entries=${t.length}  (${Date.now() - t0}ms)`);
        return t;
      }),
    ]);

    if (transcript.length === 0) {
      console.warn(`[process-url] 422 — transcript array was empty for videoId=${videoId}`);
      return NextResponse.json({ error: "No transcript content found for this video." }, { status: 422 });
    }

    console.log(`[process-url] running AI agents (outline + summaries + cards)…`);
    const t1 = Date.now();
    const { lecture, studyMaterials } = await processTranscript(transcript, metadata);
    console.log(`[process-url] AI done  sections=${lecture.sections.length} flashcards=${studyMaterials.flashcards.length} concepts=${studyMaterials.concepts.length}  (${Date.now() - t1}ms)`);

    if (isRagConfigured()) {
      try {
        const chunks = buildLectureChunksFromTranscript(transcript, lecture);
        console.log(`[process-url] RAG indexing ${chunks.length} chunks…`);
        if (chunks.length > 0) {
          await indexLectureForRag(videoId, chunks);
          console.log(`[process-url] RAG index OK`);
        }
      } catch (err) {
        console.error("[process-url] RAG indexing failed:", err);
      }
    }

    console.log(`[process-url] ✅ done  total=${Date.now() - t0}ms`);
    return NextResponse.json({
      videoId,
      metadata,
      lecture,
      studyMaterials,
      transcript,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    const stack  = error instanceof Error ? error.stack : undefined;
    const lower  = message.toLowerCase();
    const status =
      lower.includes("private") || lower.includes("unavailable") ? 422
      : lower.includes("captions") || lower.includes("transcript") || lower.includes("disabled") ? 422
      : lower.includes("timed out") || lower.includes("timeout") ? 504
      : lower.includes("live") ? 422
      : 500;

    // Surface a clean user-facing reason
    const userMessage =
      lower.includes("private")            ? "This video is private. Please use a public lecture URL." :
      lower.includes("unavailable")        ? "This video is unavailable or has been removed." :
      lower.includes("live") || lower.includes("livestream") ? "Live streams don't have transcripts yet. Try again after the stream ends." :
      lower.includes("disabled") || lower.includes("captions") || lower.includes("transcript") ?
        "This video has no captions or transcripts available. YouTube must have CC enabled for this to work." :
      lower.includes("age")               ? "This video is age-restricted and cannot be processed." :
      lower.includes("timed out") || lower.includes("timeout") ? "The request timed out. Please try again." :
      message;

    console.error(`[process-url] ❌ ${status}  videoId=${videoId}  message=${message}`);
    if (stack) console.error(`[process-url] stack:\n${stack}`);
    return NextResponse.json({ error: userMessage }, { status });
  }
}
