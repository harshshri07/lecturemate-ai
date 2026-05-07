import { YoutubeTranscript } from "youtube-transcript";

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

export async function fetchTranscript(videoId: string): Promise<TranscriptEntry[]> {
  // Try a sequence of language tracks before giving up.
  // Many lectures have auto-generated captions in the original language but not English.
  const languagesToTry = ["en", "en-US", "en-GB", "es", "fr", "de", "hi", "zh", "ja", "ko", "pt", "ru"];

  let lastError: unknown = null;

  // 1. Try each language explicitly
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

  // 2. Last-ditch: ask for whatever caption track exists (no lang param)
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

  // 3. Friendly error
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  if (msg.includes("private") || msg.includes("unavailable")) {
    throw new Error("This video is private or unavailable. Try a public video.");
  }
  throw new Error(
    "This video has no captions in any supported language. Try a different lecture, or pick one where the YouTube CC button is visible."
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
