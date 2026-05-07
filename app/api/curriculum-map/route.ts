import { NextRequest, NextResponse } from "next/server";
import { extractVideoId, fetchTranscript, fetchVideoMetadata, validateYouTubeUrl } from "@/lib/youtube";
import { generateTopicFingerprint } from "@/lib/agents/topicFingerprint";
import { generateCurriculumMap } from "@/lib/agents/curriculumMap";

export const maxDuration = 120;

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = `provost:${ip}`;
  const entry = rateLimiter.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded for curriculum mapping." }, { status: 429 });
  }

  let urls: unknown;
  let objectives: unknown;
  try {
    const body = await req.json();
    urls = body.urls;
    objectives = body.objectives;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty urls array." }, { status: 400 });
  }
  if (urls.length > 8) {
    return NextResponse.json({ error: "Maximum 8 lecture URLs per request." }, { status: 400 });
  }

  const urlStrings = urls.map((u) => String(u).trim()).filter(Boolean);
  if (!Array.isArray(objectives) || objectives.length === 0) {
    return NextResponse.json({ error: "Provide objectives as a non-empty array of strings." }, { status: 400 });
  }
  const objectiveStrings = objectives.map((o) => String(o).trim()).filter(Boolean);
  if (objectiveStrings.length > 20) {
    return NextResponse.json({ error: "Maximum 20 learning objectives." }, { status: 400 });
  }

  const perVideo: { videoId: string; url: string; metadata?: { title: string; channelName: string }; error?: string }[] = [];

  const fingerprintResults = await Promise.all(
    urlStrings.map(async (url) => {
      const validation = validateYouTubeUrl(url);
      if (!validation.valid) {
        perVideo.push({ videoId: "", url, error: validation.error });
        return null;
      }
      const videoId = extractVideoId(url)!;
      try {
        const [metadata, transcript] = await Promise.all([
          fetchVideoMetadata(videoId),
          fetchTranscript(videoId),
        ]);
        if (transcript.length === 0) {
          perVideo.push({ videoId, url, error: "No transcript for this video." });
          return null;
        }
        const fp = await generateTopicFingerprint(transcript, metadata, videoId);
        perVideo.push({ videoId, url, metadata: { title: metadata.title, channelName: metadata.channelName } });
        return fp;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to fetch lecture.";
        perVideo.push({ videoId, url, error: msg });
        return null;
      }
    })
  );

  const fingerprints = fingerprintResults.filter((f): f is NonNullable<typeof f> => f !== null);

  if (fingerprints.length === 0) {
    return NextResponse.json(
      { error: "No lectures could be processed.", perVideo },
      { status: 422 }
    );
  }

  const report = await generateCurriculumMap(objectiveStrings, fingerprints);

  return NextResponse.json({ report, perVideo, fingerprints });
}
