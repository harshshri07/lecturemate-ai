import { YoutubeTranscript } from "youtube-transcript";
import { getSubtitles } from "youtube-caption-extractor";

export interface VideoMetadata {
  videoId: string;
  title: string;
  duration: number;
  thumbnailUrl: string;
  channelName: string;
}

export interface TranscriptEntry {
  text: string;
  offset: number;
  duration: number;
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function validateYouTubeUrl(url: string): { valid: boolean; error?: string } {
  if (!url || url.trim() === "") {
    return { valid: false, error: "Please enter a YouTube URL." };
  }
  const videoId = extractVideoId(url);
  if (!videoId) {
    return { valid: false, error: "Invalid YouTube URL. Please use a standard youtube.com or youtu.be link." };
  }
  return { valid: true };
}

/** Map youtube-caption-extractor rows to our transcript format. */
function mapExtractorSubtitles(
  subs: { start: string; dur: string; text: string }[]
): TranscriptEntry[] {
  return subs
    .map((s) => ({
      text: s.text.trim(),
      offset: Number.parseFloat(s.start) || 0,
      duration: Math.max(0.05, Number.parseFloat(s.dur) || 0.2),
    }))
    .filter((e) => e.text.length > 0);
}

/**
 * Fallback when `youtube-transcript` breaks (YouTube HTML/API changes are common).
 * Uses InnerTube-style fetches and caption XML, including on Vercel where the old library often fails.
 */
async function fetchTranscriptViaExtractor(videoId: string): Promise<TranscriptEntry[] | null> {
  const languagesToTry = [
    "en",
    "en-US",
    "en-GB",
    "hi",
    "bn",
    "ta",
    "te",
    "mr",
    "gu",
    "kn",
    "ml",
    "es",
    "fr",
    "de",
    "pt",
    "it",
    "nl",
    "pl",
    "ru",
    "uk",
    "zh",
    "zh-Hans",
    "ja",
    "ko",
    "vi",
    "th",
    "id",
    "ar",
    "tr",
  ];
  for (const lang of languagesToTry) {
    try {
      const subs = await getSubtitles({ videoID: videoId, lang });
      if (subs.length > 0) return mapExtractorSubtitles(subs);
    } catch {
      /* try next language */
    }
  }
  return null;
}

export async function fetchTranscript(videoId: string): Promise<TranscriptEntry[]> {
  // Try a sequence of language tracks before giving up.
  // Many lectures have auto-generated captions in the original language but not English.
  const languagesToTry = ["en", "en-US", "en-GB", "es", "fr", "de", "hi", "zh", "ja", "ko", "pt", "ru"];

  let lastError: unknown = null;

  // 1. Prefer default track first (youtube-transcript)
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (transcript.length > 0) {
      return transcript.map((entry) => ({
        text: entry.text,
        offset: entry.offset / 1000,
        duration: entry.duration / 1000,
      }));
    }
  } catch (err) {
    lastError = err;
  }

  // 2. Try each language explicitly
  for (const lang of languagesToTry) {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (transcript.length > 0) {
        return transcript.map((entry) => ({
          text: entry.text,
          offset: entry.offset / 1000,
          duration: entry.duration / 1000,
        }));
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 3. Robust fallback (often works when CC is visible but youtube-transcript fails)
  try {
    const viaExtractor = await fetchTranscriptViaExtractor(videoId);
    if (viaExtractor && viaExtractor.length > 0) return viaExtractor;
  } catch (err) {
    lastError = err;
  }

  // 4. Friendly error
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  if (msg.includes("private") || msg.includes("unavailable")) {
    throw new Error("This video is private or unavailable. Try a public video.");
  }
  throw new Error(
    "We could not download captions for this video. YouTube sometimes blocks transcript access from hosted servers even when captions play in your browser. Try again in a bit, paste a shorter clip, or use a lecture listed under Try."
  );
}

export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  // Use oEmbed API (no API key required) for title/channel
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  
  let title = "YouTube Lecture";
  let channelName = "Unknown Channel";

  try {
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      title = data.title ?? title;
      channelName = data.author_name ?? channelName;
    }
  } catch {
    // fallback to defaults
  }

  return {
    videoId,
    title,
    duration: 0,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    channelName,
  };
}

export function transcriptToText(entries: TranscriptEntry[]): string {
  return entries
    .map((e) => `[${formatTimestamp(e.offset)}] ${e.text}`)
    .join(" ");
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
