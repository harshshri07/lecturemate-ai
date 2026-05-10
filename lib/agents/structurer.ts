import { invokeAgent } from "../bedrock";
import { TranscriptEntry, VideoMetadata } from "../youtube";

export interface LectureSection {
  title: string;
  startTime: number;
  endTime: number;
  summary: string;
  rawText: string;
}

export interface StructuredLecture {
  title: string;
  duration: number;
  sections: LectureSection[];
}

const SYSTEM_PROMPT = `You are a lecture analyst. Your only job is to segment a raw transcript into logical topic blocks and produce a clean structured outline with timestamps. You must return ONLY valid JSON with no extra commentary, markdown, or explanation. Never truncate the JSON. Never use em dashes in any text output. Use commas, periods, or colons instead.`;

export async function structureTranscript(
  entries: TranscriptEntry[],
  metadata: VideoMetadata
): Promise<StructuredLecture> {
  const totalDuration = entries.length > 0
    ? Math.ceil(entries[entries.length - 1].offset + entries[entries.length - 1].duration)
    : 0;

  const transcriptText = entries
    .map((e) => `[${Math.floor(e.offset)}s] ${e.text}`)
    .join(" ");

  const truncated = transcriptText.length > 12000
    ? transcriptText.slice(0, 12000) + "... [truncated for length]"
    : transcriptText;

  const userMessage = `Video title: "${metadata.title}"
Channel: "${metadata.channelName}"
Total duration: ${totalDuration} seconds

Raw transcript (with second-offsets in brackets):
${truncated}

Return a JSON object in exactly this format:
{
  "title": "descriptive title of the lecture",
  "duration": ${totalDuration},
  "sections": [
    {
      "title": "section title",
      "startTime": 0,
      "endTime": 420,
      "summary": "2-3 sentence summary of what this section covers",
      "rawText": "the actual transcript text for this section"
    }
  ]
}

Create between 4 and 10 sections. Each section should cover a coherent topic. Times must be integers in seconds.`;

  const raw = await invokeAgent(SYSTEM_PROMPT, userMessage);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const parsed = JSON.parse(jsonMatch[0]) as StructuredLecture;

    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      throw new Error("Invalid structure: missing sections array");
    }

    return {
      title: parsed.title ?? metadata.title,
      duration: parsed.duration ?? totalDuration,
      sections: parsed.sections.map((s, i) => ({
        title: s.title ?? `Section ${i + 1}`,
        startTime: Number(s.startTime) ?? 0,
        endTime: Number(s.endTime) ?? totalDuration,
        summary: s.summary ?? "",
        rawText: s.rawText ?? "",
      })),
    };
  } catch (err) {
    // Fallback: create a single section
    return {
      title: metadata.title,
      duration: totalDuration,
      sections: [
        {
          title: "Full Lecture",
          startTime: 0,
          endTime: totalDuration,
          summary: "Complete lecture content",
          rawText: truncated,
        },
      ],
    };
  }
}
