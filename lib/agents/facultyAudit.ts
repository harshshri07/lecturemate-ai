import { invokeAgent, MODEL_HAIKU } from "../bedrock";
import { TranscriptEntry, VideoMetadata } from "../youtube";

export interface FacultyFixItem {
  priority: number;
  title: string;
  rationale: string;
  timestamp?: number;
  suggestedRewrite?: string;
}

export interface FacultyAuditReport {
  publishReady?: boolean;
  /** When there are majors: the single highest-leverage systemic fix sentence ( Capability 2 "if you change one thing..." ). */
  oneThingToFix: string;
  fixes: FacultyFixItem[];
  /** Pedagogy aligned with Capability 2: objectives, scaffolding, checks for understanding, progression (bullet support when majors exist only). */
  pedagogy: string[];
  accessibility: string[];
  equity: string[];
  clarity: string[];
  /** What transcript evidence suggests is already working — required when no majors; supports "what isn't" vs "what is". */
  workingWell: string[];
}

/** Shown when the model finds no publish-blocking issues (server-enforced consistency). */
export const FACULTY_DEFAULT_PUBLICATION_READY =
  "No major instructional gaps showed up in this transcript-only review. Your lecture reads publication-ready.";

const STRENGTHS_FALLBACK: string[] = [
  "The sampled transcript does not expose a systemic barrier you would need to resolve before broader publication.",
];

const SYSTEM = `You are an expert instructional designer and accessibility reviewer. Your reader is an experienced educator (professor, lecturer, specialist). Write with professional respect — never tutorial tone, nitpicks, or cosmetic feedback.

Produce a PRIVATE, voluntary teaching-improvement audit. This is NOT surveillance: do not infer student demographics, grades, or identities. Base feedback only on observable transcript content.

Capability 2 rubric dimensions (you must honor all four naming conventions in JSON): pedagogical reasoning, accessibility, equity and inclusion, and clarity of explanation.

Return ONLY valid JSON, no markdown, no code fences, no preamble. Never use em dashes. Use commas, periods, or colons instead.`;

export async function generateFacultyAudit(
  entries: TranscriptEntry[],
  metadata: VideoMetadata
): Promise<FacultyAuditReport> {
  const totalDuration =
    entries.length > 0
      ? Math.ceil(entries[entries.length - 1].offset + entries[entries.length - 1].duration)
      : 0;

  const step = Math.max(1, Math.floor(entries.length / 100));
  const sampled = entries.filter((_, i) => i % step === 0);
  const text = sampled.map((e) => `[${Math.floor(e.offset)}s] ${e.text}`).join(" ");
  const transcript = text.length > 9000 ? text.slice(0, 9000) + "…" : text;

  const userMessage = `Video title: "${metadata.title}" | Channel: "${metadata.channelName}" | Duration: ${totalDuration}s

Transcript (timestamped, sampled for review):
${transcript}

Return exactly this JSON shape:
{
  "publishReady": true,
  "oneThingToFix": "One concise verdict sentence.",
  "fixes": [],
  "pedagogy": [],
  "accessibility": [],
  "equity": [],
  "clarity": [],
  "workingWell": ["2-4 short bullets grounded in transcript: strengths an experienced peer would concede."]
}

Governance — read carefully:
A. Major flaws only in fixes: list ONLY if omission could confuse many learners, gate core concepts, imply correctness errors, or show clear exclusionary wording in what was said. Prefer fixes: [].
B. Do NOT mention: filler words, um/uh, micro-pacing, polish, voice style, transitions for style only, or production details not in transcript.
C. Maximum 3 fixes. priority must be 1, 2, or 3. Each fix: timestamp when possible, optional suggestedRewrite only if it clearly improves a substantive issue.
D. If fixes=[]: publishReady=true. Set pedagogy, accessibility, equity, clarity to [] (no dimension nitpicks). Populate workingWell with 2-4 distinct strengths that map across pedagogy, accessibility, equity, and clarity where honestly supported (one bullet can combine ideas). oneThingToFix affirms readiness without hedging.
E. If fixes non-empty: publishReady=false. oneThingToFix must name the single highest-leverage change before publishing (Capability 2 "if you change one thing, change this", colleague tone). pedagogy, accessibility, equity, clarity: each 0-1 items only, under 200 characters, only if they materially support the listed fixes. workingWell: 0-2 optional bullets for genuine strengths that still hold despite the gaps.
F. Rationale under 200 characters per fix; title under 80 characters.

Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM, userMessage, 2400, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as Partial<FacultyAuditReport>;

    const fixes: FacultyFixItem[] = Array.isArray(p.fixes)
      ? p.fixes.slice(0, 12).map((f) => ({
          priority: Math.max(1, Math.min(3, Number(f.priority) || 3)),
          title: String(f.title ?? "Review point").slice(0, 120),
          rationale: String(f.rationale ?? "").slice(0, 260),
          timestamp:
            f.timestamp !== undefined && f.timestamp !== null
              ? Math.max(0, Math.min(totalDuration, Number(f.timestamp)))
              : undefined,
          suggestedRewrite: f.suggestedRewrite ? String(f.suggestedRewrite).slice(0, 400) : undefined,
        }))
      : [];

    const cappedFixes = fixes.slice(0, 3);

    const publishReady = cappedFixes.length === 0;

    const parseStrengths = (): string[] => {
      const w = Array.isArray(p.workingWell) ? p.workingWell.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [];
      return w.map((s) => s.slice(0, 240));
    };

    if (publishReady) {
      const verdict =
        typeof p.oneThingToFix === "string" && p.oneThingToFix.trim().length > 0
          ? p.oneThingToFix.trim()
          : FACULTY_DEFAULT_PUBLICATION_READY;

      let workingWell = parseStrengths();
      if (workingWell.length === 0) workingWell = [...STRENGTHS_FALLBACK];

      return {
        publishReady: true,
        oneThingToFix: verdict,
        fixes: [],
        pedagogy: [],
        accessibility: [],
        equity: [],
        clarity: [],
        workingWell,
      };
    }

    const pedagogyRaw = Array.isArray(p.pedagogy) ? p.pedagogy.map(String).slice(0, 1) : [];
    const accessibilityRaw = Array.isArray(p.accessibility) ? p.accessibility.map(String).slice(0, 1) : [];
    const equityRaw = Array.isArray(p.equity) ? p.equity.map(String).slice(0, 1) : [];
    const clarityRaw = Array.isArray(p.clarity) ? p.clarity.map(String).slice(0, 1) : [];
    const workingWellWithGaps = parseStrengths().slice(0, 2);

    const top = cappedFixes[0];
    const fallbackLead =
      top ? `If you change one thing before publishing: address ${top.title}. ${top.rationale}` : FACULTY_DEFAULT_PUBLICATION_READY;

    return {
      publishReady: false,
      oneThingToFix:
        typeof p.oneThingToFix === "string" && p.oneThingToFix.trim().length > 0
          ? p.oneThingToFix.trim().slice(0, 400)
          : fallbackLead.slice(0, 400),
      fixes: cappedFixes,
      pedagogy: pedagogyRaw.map((s) => s.slice(0, 220)),
      accessibility: accessibilityRaw.map((s) => s.slice(0, 220)),
      equity: equityRaw.map((s) => s.slice(0, 220)),
      clarity: clarityRaw.map((s) => s.slice(0, 220)),
      workingWell: workingWellWithGaps,
    };
  } catch {
    return {
      publishReady: false,
      oneThingToFix: "Re-run the audit; the model returned non-JSON output.",
      fixes: [{ priority: 1, title: "Parse error", rationale: "Try again. If persistent, reduce video length.", timestamp: 0 }],
      pedagogy: [],
      accessibility: [],
      equity: [],
      clarity: [],
      workingWell: [],
    };
  }
}
