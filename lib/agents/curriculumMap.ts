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
  /** Leadership narrative: stewards catalog promise, accreditation, and student-facing claims. */
  overallNotes: string;
}

/** Ensure every stated objective appears once — align model rows to syllabus order without stealing rows across objectives. */
export function normalizeObjectiveCoverage(
  objectives: string[],
  rows: ObjectiveCoverageRow[],
): ObjectiveCoverageRow[] {
  const pool = rows.map((r) => ({ ...r }));

  function takeBestMatch(objectiveInput: string): ObjectiveCoverageRow | null {
    const o = objectiveInput.trim();
    const lower = o.toLowerCase();

    let idx = pool.findIndex((r) => r.objective.trim().toLowerCase() === lower);
    if (idx >= 0) {
      const [row] = pool.splice(idx, 1);
      return row ?? null;
    }

    if (o.length >= 12) {
      idx = pool.findIndex((r) => {
        const ro = r.objective.trim().toLowerCase();
        if (!ro) return false;
        const probe = Math.min(40, lower.length);
        return ro.includes(lower.slice(0, probe)) || lower.includes(ro.slice(0, Math.min(40, ro.length)));
      });
      if (idx >= 0) {
        const [row] = pool.splice(idx, 1);
        return row ?? null;
      }
    }

    return null;
  }

  return objectives.map((objectiveText) => {
    const chosen = takeBestMatch(objectiveText);

    if (!chosen) {
      return {
        objective: objectiveText,
        coverageLevel: "Missing" as const,
        evidence: [],
      };
    }

    return {
      objective: objectiveText,
      coverageLevel: chosen.coverageLevel,
      evidence: chosen.evidence,
    };
  });
}

const SYSTEM = `You are an academic quality assurance analyst helping a provost (or dean) steward catalog promises against real instruction.

Capability 3: ingest evidence from multiple lectures in ONE course (via fingerprints), compare stated learning objectives against what instructors actually conveyed in transcripts, not syllabi-only intent.

Fingerprints summarize topics and claims grounded in transcripts. Never invent teachings not indicated by fingerprints. Return ONLY valid JSON, no markdown, no explanation. Never use em dashes. Use commas, periods, or colons instead.`;

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

  const userMessage = `Stated course learning objectives (verbatim from catalog, syllabus, or instructor input):
${objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Lecture fingerprints from this course (JSON, transcript-derived):
${JSON.stringify(fpSummary)}

Return exactly:
{
  "objectiveCoverage": [
    {
      "objective": "copy objective text EXACTLY as provided above for that row",
      "coverageLevel": "High" | "Medium" | "Low" | "Missing",
      "evidence": [
        { "lectureTitle": "...", "timestamp": 120, "quoteOrParaphrase": "short paraphrase tied to fingerprint" }
      ]
    }
  ],
  "gaps": ["objectives under-served, thin, or missing relative to stated promise"],
  "redundancies": ["topics or skills repeated heavily across lectures"],
  "overallNotes": "2-5 sentences for leadership: how well execution matches stated objectives, largest stewardship risk, and one concrete next step."
}

Rules:
- objectiveCoverage MUST have EXACTLY one row per objective above, IN THE SAME ORDER (line 1 matches objective 1, etc.). Copy each objective string verbatim into the objective field.
- coverageLevel: High when multiple fingerprints credibly support the objective; Medium when partial; Low when barely mentioned; Missing when no support.
- evidence: 0-5 items per objective; quoteOrParaphrase should be specific and tied to fingerprint claims or topics; timestamps should match fingerprint evidence when possible.
- gaps: 3-8 items where objectives are under-served relative to stated promise; redundancies: 2-6 items where topics repeat across lectures.
- Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM, userMessage, 4000, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as Partial<CurriculumMapReport>;

    const levels: CoverageLevel[] = ["High", "Medium", "Low", "Missing"];
    const rawObjectiveCoverage: ObjectiveCoverageRow[] = Array.isArray(p.objectiveCoverage)
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

    const objectiveCoverage = normalizeObjectiveCoverage(objectives, rawObjectiveCoverage);

    return {
      objectiveCoverage,
      gaps: Array.isArray(p.gaps) ? p.gaps.map(String).slice(0, 12) : [],
      redundancies: Array.isArray(p.redundancies) ? p.redundancies.map(String).slice(0, 10) : [],
      overallNotes: String(p.overallNotes ?? ""),
    };
  } catch {
    return {
      objectiveCoverage: objectives.map((o) => ({
        objective: o,
        coverageLevel: "Missing" as const,
        evidence: [],
      })),
      gaps: ["Could not parse curriculum map from model output."],
      redundancies: [],
      overallNotes: "Re-run the analysis or reduce the number of lectures.",
    };
  }
}
