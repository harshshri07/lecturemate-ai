import { invokeAgent, MODEL_HAIKU } from "../bedrock";
import type { TopicFingerprint } from "./topicFingerprint";

export type CoverageLevel = "High" | "Medium" | "Low" | "Missing";

export interface EvidenceRef {
  lectureTitle: string;
  timestamp: number;
  quoteOrParaphrase: string;
}

export interface ObjectiveCoverageRow {
  objective: string;
  coverageLevel: CoverageLevel;
  evidence: EvidenceRef[];
}

export interface CurriculumMapReport {
  objectiveCoverage: ObjectiveCoverageRow[];
  gaps: string[];
  redundancies: string[];
  overallNotes: string;
}

const SYSTEM = `You are an academic quality assurance analyst helping a provost compare what was actually taught in a set of lectures against stated course learning objectives. Use only the provided topic fingerprints (topics, claims, evidence timestamps). Do not invent content not supported by the fingerprints. Return ONLY valid JSON, no markdown, no explanation. Never use em dashes in any text. Use commas, periods, or colons instead.`;

export async function generateCurriculumMap(
  objectives: string[],
  fingerprints: TopicFingerprint[]
): Promise<CurriculumMapReport> {
  const fpSummary = fingerprints.map((f) => ({
    videoId: f.videoId,
    title: f.lectureTitle,
    topics: f.lectureTopics,
    claims: f.keyClaims,
    evidence: f.evidence,
  }));

  const userMessage = `Stated learning objectives (verbatim from the instructor):
${objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Lecture fingerprints (JSON):
${JSON.stringify(fpSummary, null, 0)}

Return exactly:
{
  "objectiveCoverage": [
    {
      "objective": "copy objective text",
      "coverageLevel": "High" | "Medium" | "Low" | "Missing",
      "evidence": [
        { "lectureTitle": "...", "timestamp": 120, "quoteOrParaphrase": "short paraphrase tied to fingerprint" }
      ]
    }
  ],
  "gaps": ["objectives or skills under-served across lectures"],
  "redundancies": ["topics taught repeatedly across multiple lectures"],
  "overallNotes": "2-4 sentences for leadership: strengths, risks, and next step."
}

Rules:
- objectiveCoverage: one row per stated objective above, same order.
- evidence: 0-5 items per objective; timestamps must come from fingerprint evidence when possible.
- coverageLevel: High if strongly supported across fingerprints; Medium if partial; Low if barely mentioned; Missing if no support.
- gaps: 3-8 items; redundancies: 2-6 items.
- Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM, userMessage, 2800, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as Partial<CurriculumMapReport>;

    const levels: CoverageLevel[] = ["High", "Medium", "Low", "Missing"];
    const objectiveCoverage: ObjectiveCoverageRow[] = Array.isArray(p.objectiveCoverage)
      ? p.objectiveCoverage.map((row) => ({
          objective: String(row.objective ?? ""),
          coverageLevel: (levels.includes(row.coverageLevel as CoverageLevel)
            ? (row.coverageLevel as CoverageLevel)
            : "Medium"),
          evidence: Array.isArray(row.evidence)
            ? row.evidence.slice(0, 6).map((e) => ({
                lectureTitle: String(e.lectureTitle ?? ""),
                timestamp: Math.max(0, Number(e.timestamp) || 0),
                quoteOrParaphrase: String(e.quoteOrParaphrase ?? "").slice(0, 280),
              }))
            : [],
        }))
      : objectives.map((o) => ({ objective: o, coverageLevel: "Missing" as const, evidence: [] }));

    return {
      objectiveCoverage,
      gaps: Array.isArray(p.gaps) ? p.gaps.map(String).slice(0, 12) : [],
      redundancies: Array.isArray(p.redundancies) ? p.redundancies.map(String).slice(0, 10) : [],
      overallNotes: String(p.overallNotes ?? ""),
    };
  } catch {
    return {
      objectiveCoverage: objectives.map((o) => ({ objective: o, coverageLevel: "Missing" as const, evidence: [] })),
      gaps: ["Could not parse curriculum map from model output."],
      redundancies: [],
      overallNotes: "Re-run the analysis or reduce the number of lectures.",
    };
  }
}
