import { invokeAgent, MODEL_HAIKU } from "../bedrock";
import { TranscriptEntry, VideoMetadata } from "../youtube";

export interface ConceptNode {
  name: string;
  importance: number; // 1–10
  connectsTo: string[]; // names of other concepts in this set
}

export interface DifficultySegment {
  label: string;
  difficulty: "easy" | "medium" | "hard";
  startTime: number;
  endTime: number;
}

export interface LectureInsights {
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedStudyMinutes: number;
  concepts: ConceptNode[];
  difficultyTimeline: DifficultySegment[];
  prerequisites: string[];
  nextSteps: string[];
  keyTakeaways: string[];
}

const SYSTEM_PROMPT = `You are an expert learning analyst. Analyze a lecture transcript and produce a structured study insight report. Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

export async function generateInsights(
  entries: TranscriptEntry[],
  metadata: VideoMetadata
): Promise<LectureInsights> {
  const totalDuration = entries.length > 0
    ? Math.ceil(entries[entries.length - 1].offset + entries[entries.length - 1].duration)
    : 0;

  const step = Math.max(1, Math.floor(entries.length / 90));
  const sampled = entries.filter((_, i) => i % step === 0);
  const text = sampled.map((e) => `[${Math.floor(e.offset)}s] ${e.text}`).join(" ");
  const transcript = text.length > 7000 ? text.slice(0, 7000) + "…" : text;

  const userMessage = `Title: "${metadata.title}" | Duration: ${totalDuration}s
Transcript (sampled): ${transcript}

Return exactly this JSON shape:
{
  "difficulty": "beginner" | "intermediate" | "advanced",
  "estimatedStudyMinutes": 30,
  "concepts": [
    { "name": "concept name", "importance": 8, "connectsTo": ["other concept name"] }
  ],
  "difficultyTimeline": [
    { "label": "section title", "difficulty": "easy" | "medium" | "hard", "startTime": 0, "endTime": 300 }
  ],
  "prerequisites": ["topic the student should know first"],
  "nextSteps": ["topic to study after this"],
  "keyTakeaways": ["the single most important insight from the lecture"]
}

Rules:
- 8-12 concepts total. importance is an integer 1-10. connectsTo lists 1-3 OTHER concepts from this set (must match a name above).
- 4-6 timeline segments covering the full duration. Timestamps integers in seconds, 0–${totalDuration}.
- 3-5 prerequisites (short phrases, ≤6 words each).
- 3-5 nextSteps (short phrases, ≤6 words each).
- Exactly 3 keyTakeaways (clear, complete sentences).
- Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM_PROMPT, userMessage, 1600, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON in response");
    const p = JSON.parse(m[0]) as Partial<LectureInsights>;

    // Sanitize
    const concepts: ConceptNode[] = Array.isArray(p.concepts)
      ? p.concepts.slice(0, 12).map((c) => ({
          name: String(c.name ?? "Concept"),
          importance: Math.max(1, Math.min(10, Number(c.importance) || 5)),
          connectsTo: Array.isArray(c.connectsTo) ? c.connectsTo.slice(0, 3).map(String) : [],
        }))
      : [];

    const difficultyTimeline: DifficultySegment[] = Array.isArray(p.difficultyTimeline)
      ? p.difficultyTimeline.slice(0, 6).map((d) => ({
          label: String(d.label ?? "Section"),
          difficulty: ["easy", "medium", "hard"].includes(d.difficulty ?? "")
            ? (d.difficulty as DifficultySegment["difficulty"])
            : "medium",
          startTime: Math.max(0, Number(d.startTime) || 0),
          endTime: Math.max(0, Math.min(totalDuration, Number(d.endTime) || totalDuration)),
        }))
      : [];

    return {
      difficulty: ["beginner", "intermediate", "advanced"].includes(p.difficulty ?? "")
        ? (p.difficulty as LectureInsights["difficulty"])
        : "intermediate",
      estimatedStudyMinutes: Math.max(5, Math.min(180, Number(p.estimatedStudyMinutes) || 30)),
      concepts,
      difficultyTimeline,
      prerequisites: Array.isArray(p.prerequisites) ? p.prerequisites.slice(0, 5).map(String) : [],
      nextSteps: Array.isArray(p.nextSteps) ? p.nextSteps.slice(0, 5).map(String) : [],
      keyTakeaways: Array.isArray(p.keyTakeaways) ? p.keyTakeaways.slice(0, 3).map(String) : [],
    };
  } catch {
    return {
      difficulty: "intermediate",
      estimatedStudyMinutes: 30,
      concepts: [],
      difficultyTimeline: [],
      prerequisites: [],
      nextSteps: [],
      keyTakeaways: [],
    };
  }
}
