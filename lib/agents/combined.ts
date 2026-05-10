import { invokeAgent, MODEL_HAIKU, MODEL_SONNET } from "../bedrock";
import { TranscriptEntry, VideoMetadata } from "../youtube";
import { StructuredLecture } from "./structurer";
import { StudyMaterials, sortFlashcardsChronologically } from "./studyMaterialGenerator";

export interface CombinedOutput {
  lecture: StructuredLecture;
  studyMaterials: StudyMaterials;
}

// Scale flashcard/section counts based on video length
function getCountsForDuration(totalDuration: number): { sections: number; flashcards: number; concepts: number } {
  if (totalDuration < 600)  return { sections: 3, flashcards: 4,  concepts: 6  }; // < 10 min
  if (totalDuration < 1800) return { sections: 5, flashcards: 7,  concepts: 8  }; // 10-30 min
  if (totalDuration < 3600) return { sections: 6, flashcards: 10, concepts: 10 }; // 30-60 min
  if (totalDuration < 7200) return { sections: 8, flashcards: 14, concepts: 12 }; // 1-2 hrs
  return                           { sections: 10, flashcards: 18, concepts: 14 }; // 2+ hrs
}

// Build an evenly-sampled transcript string that covers the full video duration
function sampleTranscript(entries: TranscriptEntry[], maxChars: number): string {
  if (entries.length === 0) return "";
  const step = Math.max(1, Math.floor(entries.length / 100));
  const sampled = entries.filter((_, i) => i % step === 0);
  const text = sampled.map((e) => `[${Math.floor(e.offset)}s] ${e.text}`).join(" ");
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

// Agent A: outline (Haiku, fast, cheap)
async function buildOutline(
  transcript: string,
  metadata: VideoMetadata,
  totalDuration: number,
  numSections: number
): Promise<StructuredLecture> {
  const sys = `You are a lecture analyst. Return ONLY valid JSON, no markdown, no explanation. Never use em dashes in any text.`;
  const msg = `Title: "${metadata.title}" | Duration: ${totalDuration}s
Transcript (evenly sampled): ${transcript}

Return ONLY this JSON (no text before or after):
{"title":"concise title","duration":${totalDuration},"sections":[{"title":"section title","startTime":0,"endTime":60,"summary":"1-sentence summary"}]}

Rules:
- Exactly ${numSections} sections covering the full lecture from 0 to ${totalDuration}s
- Each section startTime/endTime are integers in seconds
- summary is one concise sentence
- No rawText field needed
- Return ONLY the JSON`;

  const raw = await invokeAgent(sys, msg, Math.max(1400, numSections * 180), MODEL_HAIKU);
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as StructuredLecture;
    return {
      title: p.title ?? metadata.title,
      duration: p.duration ?? totalDuration,
      sections: Array.isArray(p.sections) && p.sections.length > 0
        ? p.sections.map((s, i) => ({
            title: s.title ?? `Section ${i + 1}`,
            startTime: Number(s.startTime) || 0,
            endTime: Number(s.endTime) || totalDuration,
            summary: s.summary ?? "",
            rawText: s.rawText ?? "",
          }))
        : [{ title: "Full Lecture", startTime: 0, endTime: totalDuration, summary: "", rawText: "" }],
    };
  } catch {
    return {
      title: metadata.title,
      duration: totalDuration,
      sections: [{ title: "Full Lecture", startTime: 0, endTime: totalDuration, summary: "", rawText: "" }],
    };
  }
}

// Agent B: summaries (Sonnet for writing quality; runs in parallel with Haiku outline + cards)
async function buildSummaries(
  transcript: string,
  metadata: VideoMetadata
): Promise<StudyMaterials["summaries"]> {
  const sys = `You are a study coach. Return ONLY valid JSON, no markdown, no explanation outside the strings. Never use the em dash or en dash Unicode characters in any summary text.

Summary formatting rules (critical):
- Do not chain enumerated topics with spaced hyphens (avoid "concept A - concept B - concept C" jammed into one paragraph).
- Aim for a natural mix you choose: introductory or framing sentences as prose where they read well; switch to Markdown-style bullet lists (each line begins with "- ") when outlining several comparable items, steps, or topics. Blank lines (double newlines) inside the JSON strings separate prose blocks from bullet blocks.
- If a section stays narrative, keep it as uninterrupted paragraphs rather than forcing bullets everywhere.
- If you use bullets, each bullet must start its own line with "- "; use **bold** for short labels sparingly (**Term**: explanation works).
- Ordinary hyphens in compounds (self-paced, plug-in) stay ASCII.
`;
  const msg = `Title: "${metadata.title}"
Transcript: ${transcript}

Return exactly:
{"short":"~80-word punchy overview","medium":"~220-word summary with key points","full":"~450-word comprehensive breakdown"}

Use bullets in medium/long only when lists genuinely aid scanning; otherwise polished prose paragraphs are preferable.`;

  const raw = await invokeAgent(sys, msg, 2600, MODEL_SONNET);
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as StudyMaterials["summaries"];
    return {
      short: p.short ?? "Summary unavailable.",
      medium: p.medium ?? "Summary unavailable.",
      full: p.full ?? "Summary unavailable.",
    };
  } catch {
    return { short: "Summary unavailable.", medium: "Summary unavailable.", full: "Summary unavailable." };
  }
}

// Agent C: flashcards + concepts (Haiku, fast, cheap)
async function buildCards(
  transcript: string,
  metadata: VideoMetadata,
  totalDuration: number,
  numFlashcards: number,
  numConcepts: number
): Promise<{ flashcards: StudyMaterials["flashcards"]; concepts: StudyMaterials["concepts"] }> {
  const sys = `You are a study coach. Return ONLY valid JSON, no markdown, no explanation. Never use em dashes in any text. Use commas, periods, or colons instead.`;
  const msg = `Title: "${metadata.title}" | Duration: ${totalDuration}s
Transcript: ${transcript}

Return exactly:
{"flashcards":[{"question":"Q","answer":"A","timestamp":0,"sectionTitle":"section"}],"concepts":["concept 1","concept 2"]}

Rules:
- Exactly ${numFlashcards} flashcards, exactly ${numConcepts} concepts (≤6 words each). Timestamps are integers 0–${totalDuration}.
- Emit flashcards in chronological order by timestamp (earliest moment in the lecture first, latest last).
- Each timestamp should match when the answered idea is first substantially covered (not arbitrary ordering).`;

  const maxTok = Math.max(900, numFlashcards * 120 + numConcepts * 30);
  const raw = await invokeAgent(sys, msg, maxTok, MODEL_HAIKU);
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as { flashcards: StudyMaterials["flashcards"]; concepts: StudyMaterials["concepts"] };
    const list = Array.isArray(p.flashcards) ? p.flashcards : [];
    return {
      flashcards: sortFlashcardsChronologically(list),
      concepts: Array.isArray(p.concepts) ? p.concepts : [],
    };
  } catch {
    return { flashcards: [], concepts: [] };
  }
}

// Orchestrator: run A, B, C in parallel
export async function processTranscript(
  entries: TranscriptEntry[],
  metadata: VideoMetadata
): Promise<CombinedOutput> {
  const totalDuration = entries.length > 0
    ? Math.ceil(entries[entries.length - 1].offset + entries[entries.length - 1].duration)
    : 0;

  const { sections: numSections, flashcards: numFlashcards, concepts: numConcepts } = getCountsForDuration(totalDuration);

  const transcriptForOutline = sampleTranscript(entries, 6000);
  const transcriptForContent = sampleTranscript(entries, 8000);

  // All three agents fire simultaneously
  const [lecture, summaries, cards] = await Promise.all([
    buildOutline(transcriptForOutline, metadata, totalDuration, numSections),
    buildSummaries(transcriptForContent, metadata),
    buildCards(transcriptForContent, metadata, totalDuration, numFlashcards, numConcepts),
  ]);

  return {
    lecture,
    studyMaterials: {
      summaries,
      flashcards: cards.flashcards,
      concepts: cards.concepts,
    },
  };
}
