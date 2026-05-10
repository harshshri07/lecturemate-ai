import type { StructuredLecture } from "@/lib/agents/structurer";

export interface LectureChunkRecord {
  chunkIndex: number;
  content: string;
  startTimeSeconds: number;
  sectionTitle: string;
}

const TARGET_CHARS = 900;
const OVERLAP_CHARS = 140;

function splitIntoOverlappingChunks(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  if (t.length <= TARGET_CHARS) return [t];

  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + TARGET_CHARS, t.length);
    if (end < t.length) {
      const space = t.lastIndexOf(" ", end);
      if (space > start + 200) end = space;
    }
    chunks.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(start + TARGET_CHARS - OVERLAP_CHARS, start + 1);
  }
  return chunks.filter(Boolean);
}

/**
 * Turn structured lecture sections into overlapping transcript chunks for embedding.
 */
export function buildLectureChunks(lecture: StructuredLecture): LectureChunkRecord[] {
  const out: LectureChunkRecord[] = [];
  let chunkIndex = 0;

  for (const section of lecture.sections) {
    const header = `Section: ${section.title}`;
    const body = section.rawText?.trim() || section.summary?.trim() || "";
    const combined = body ? `${header}\n${body}` : header;
    const pieces = splitIntoOverlappingChunks(combined);

    if (pieces.length === 0) {
      out.push({
        chunkIndex: chunkIndex++,
        content: combined.slice(0, TARGET_CHARS),
        startTimeSeconds: section.startTime,
        sectionTitle: section.title,
      });
      continue;
    }

    for (const piece of pieces) {
      out.push({
        chunkIndex: chunkIndex++,
        content: piece,
        startTimeSeconds: section.startTime,
        sectionTitle: section.title,
      });
    }
  }

  return out;
}
