import { invokeAgent, MODEL_HAIKU } from "../bedrock";
import { TranscriptEntry, VideoMetadata } from "../youtube";

export interface TopicEvidence {
  topic: string;
  timestamps: number[];
}

export interface TopicFingerprint {
  videoId: string;
  lectureTitle: string;
  lectureTopics: string[];
  keyClaims: string[];
  evidence: TopicEvidence[];
}

const SYSTEM = `You are a curriculum analyst. Given a lecture transcript sample, extract a compact topic fingerprint for mapping against course learning objectives. Return ONLY valid JSON — no markdown, no explanation.`;

export async function generateTopicFingerprint(
  entries: TranscriptEntry[],
  metadata: VideoMetadata,
  videoId: string
): Promise<TopicFingerprint> {
  const totalDuration =
    entries.length > 0
      ? Math.ceil(entries[entries.length - 1].offset + entries[entries.length - 1].duration)
      : 0;

  const step = Math.max(1, Math.floor(entries.length / 80));
  const sampled = entries.filter((_, i) => i % step === 0);
  const text = sampled.map((e) => `[${Math.floor(e.offset)}s] ${e.text}`).join(" ");
  const transcript = text.length > 7000 ? text.slice(0, 7000) + "…" : text;

  const userMessage = `Title: "${metadata.title}" | Duration: ${totalDuration}s
Transcript (sampled):
${transcript}

Return exactly:
{
  "lectureTopics": ["10-20 short topic phrases actually taught"],
  "keyClaims": ["5-10 definitional or procedural claims made in the lecture"],
  "evidence": [
    { "topic": "matches one lectureTopics entry", "timestamps": [120, 340] }
  ]
}

Rules:
- lectureTopics: 10-20 items, each ≤8 words.
- keyClaims: 5-10 items, each ≤15 words.
- evidence: 8-15 rows; each topic must appear in lectureTopics; timestamps are integers in seconds 0–${totalDuration}, 1-3 per row.
- Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM, userMessage, 1600, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as Partial<TopicFingerprint>;

    const lectureTopics = Array.isArray(p.lectureTopics) ? p.lectureTopics.map(String).slice(0, 22) : [];
    const keyClaims = Array.isArray(p.keyClaims) ? p.keyClaims.map(String).slice(0, 12) : [];
    const evidence: TopicEvidence[] = Array.isArray(p.evidence)
      ? p.evidence.slice(0, 18).map((e) => ({
          topic: String(e.topic ?? ""),
          timestamps: Array.isArray(e.timestamps)
            ? e.timestamps.map((t) => Math.max(0, Math.min(totalDuration, Number(t)))).filter((n) => !Number.isNaN(n)).slice(0, 3)
            : [],
        }))
      : [];

    return {
      videoId,
      lectureTitle: metadata.title,
      lectureTopics: lectureTopics.length ? lectureTopics : ["(no topics parsed)"],
      keyClaims: keyClaims.length ? keyClaims : ["(no claims parsed)"],
      evidence,
    };
  } catch {
    return {
      videoId,
      lectureTitle: metadata.title,
      lectureTopics: [],
      keyClaims: [],
      evidence: [],
    };
  }
}
