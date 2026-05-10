import { NextRequest, NextResponse } from "next/server";
import { fetchTranscript, VideoMetadata, TranscriptEntry } from "@/lib/youtube";
import { generateInsights } from "@/lib/agents/insights";

/**
 * POST /api/lecture-insights
 * Body: { transcript?: TranscriptEntry[]; videoId?: string; metadata: VideoMetadata }
 * Prefers client-provided transcript (avoids a second YouTube fetch). Falls back to videoId fetch.
 */
export async function POST(req: NextRequest) {
  let body: {
    transcript?: TranscriptEntry[];
    videoId?: string;
    metadata?: VideoMetadata;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const metadataRaw = body.metadata;
  if (!metadataRaw || typeof metadataRaw.title !== "string") {
    return NextResponse.json({ error: "Missing metadata (need at least title/channel context)." }, { status: 400 });
  }

  const videoId = body.videoId ?? metadataRaw.videoId;
  let transcript: TranscriptEntry[] = Array.isArray(body.transcript) ? body.transcript : [];

  if (transcript.length === 0 && videoId) {
    try {
      transcript = await fetchTranscript(videoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transcript fetch failed";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  }

  if (transcript.length === 0) {
    return NextResponse.json(
      { error: "No transcript: pass transcript from the process step or a valid videoId." },
      { status: 400 },
    );
  }

  const metadata: VideoMetadata = {
    ...metadataRaw,
    videoId: metadataRaw.videoId ?? videoId ?? "",
  };

  try {
    const insights = await generateInsights(transcript, metadata);
    return NextResponse.json({ insights });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Insights generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
