import type { StructuredLecture } from "@/lib/agents/structurer";
import type { TranscriptEntry } from "@/lib/youtube";

export interface LectureChunkRecord {
  chunkIndex: number;
  content: string;
  startTimeSeconds: number;
  sectionTitle: string;
}

const TARGET_CHARS = 900;
const OVERLAP_CHARS = 140;
/** Overlap between consecutive transcript windows when chunking by cues (keeps context at splits). */
const OVERLAP_CUES = 2;

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

function sectionIndexForTimestamp(sections: StructuredLecture["sections"], t: number): number {
  if (sections.length === 0) return 0;
  if (t < sections[0].startTime) return 0;
  for (let i = 0; i < sections.length; i++) {
    const endExclusive = i + 1 < sections.length ? sections[i + 1].startTime : Number.POSITIVE_INFINITY;
    if (t >= sections[i].startTime && t < endExclusive) return i;
  }
  return sections.length - 1;
}

/**
 * Build overlapping windows from sorted transcript cues (never splits mid-cue).
 */
function chunkCuesForSection(
  cues: TranscriptEntry[],
  sectionTitle: string
): { content: string; startTimeSeconds: number }[] {
  if (cues.length === 0) return [];
  const sorted = [...cues].sort((a, b) => a.offset - b.offset);
  const out: { content: string; startTimeSeconds: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    let len = 0;
    const parts: string[] = [];
    while (j < sorted.length && len < TARGET_CHARS) {
      const line = `[${Math.floor(sorted[j].offset)}s] ${sorted[j].text.trim()}`.replace(/\s+/g, " ");
      parts.push(line);
      len += line.length + 1;
      j++;
    }
    if (j === i) j = i + 1;
    out.push({
      content: `Section: ${sectionTitle}\n${parts.join(" ")}`,
      startTimeSeconds: Math.floor(sorted[i].offset),
    });
    if (j >= sorted.length) break;
    i = Math.max(i + 1, j - OVERLAP_CUES);
  }
  return out;
}

/**
 * Prefer verbatim YouTube captions aligned to the structured outline. Falls back per-section
 * to model rawText/summary only when no cues fall in that section.
 */
export function buildLectureChunksFromTranscript(
  entries: TranscriptEntry[],
  lecture: StructuredLecture
): LectureChunkRecord[] {
  const sections = [...lecture.sections].sort((a, b) => a.startTime - b.startTime);
  if (sections.length === 0) return [];

  const buckets: TranscriptEntry[][] = sections.map(() => []);
  for (const e of entries) {
    const idx = sectionIndexForTimestamp(sections, Math.floor(e.offset));
    buckets[idx].push(e);
  }

  const out: LectureChunkRecord[] = [];
  let chunkIndex = 0;

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const cues = buckets[s];

    if (cues.length > 0) {
      const pieces = chunkCuesForSection(cues, section.title);
      for (const p of pieces) {
        out.push({
          chunkIndex: chunkIndex++,
          content: p.content,
          startTimeSeconds: p.startTimeSeconds,
          sectionTitle: section.title,
        });
      }
      continue;
    }

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
    } else {
      for (const piece of pieces) {
        out.push({
          chunkIndex: chunkIndex++,
          content: piece,
          startTimeSeconds: section.startTime,
          sectionTitle: section.title,
        });
      }
    }
  }

  return out;
}

/**
 * Legacy: chunks from structured sections only (model rawText/summary). Prefer
 * {@link buildLectureChunksFromTranscript} when captions are available.
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
