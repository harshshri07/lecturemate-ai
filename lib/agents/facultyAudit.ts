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
  oneThingToFix: string;
  fixes: FacultyFixItem[];
  accessibility: string[];
  equity: string[];
  clarity: string[];
}

const SYSTEM = `You are an expert instructional designer and accessibility reviewer. You produce a PRIVATE, voluntary teaching-improvement audit for the instructor who recorded or will publish this lecture. This is NOT surveillance: do not infer student demographics, grades, or identities. Base feedback only on observable transcript content (what was said, structure, jargon, pacing cues, signposting). Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

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

Transcript (timestamped, sampled):
${transcript}

Return exactly this JSON shape:
{
  "publishReady": true,
  "oneThingToFix": "If you change one thing before publishing, change this (one clear sentence).",
  "fixes": [
    { "priority": 1, "title": "short title", "rationale": "why it matters", "timestamp": 120, "suggestedRewrite": "optional concrete rewrite or script line" }
  ],
  "accessibility": ["bullet about captions, pace, jargon, visuals, or audio clarity — transcript-observable only"],
  "equity": ["bullet about inclusive language, assumptions in examples, restraint — no demographic guessing"],
  "clarity": ["bullet about learning goals, signposting, definitions, recap — observable in transcript"]
}

Rules:
- Be conservative. Only recommend changes that are truly necessary for comprehension, accessibility, or correctness. Ignore cosmetic style nits (filler words, pauses) unless they block understanding.
- fixes: 0–3 items total, ordered by necessity. priority is integer 1–3. If nothing critical is needed, return fixes as [] and publishReady=true.
- oneThingToFix: if publishReady=true, set to a short reassurance like "Publish-ready; optional improvements are below if you want them." Otherwise align with the top fix.
- rationale: keep each under 140 characters.
- suggestedRewrite: only if it materially improves clarity; keep each under 160 characters.
- accessibility/equity/clarity: 0–2 items each (short, under 160 chars). Prefer empty arrays over nitpicks.
- Return ONLY the JSON.`;

  const raw = await invokeAgent(SYSTEM, userMessage, 1500, MODEL_HAIKU);

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const p = JSON.parse(m[0]) as Partial<FacultyAuditReport>;

    const fixes: FacultyFixItem[] = Array.isArray(p.fixes)
      ? p.fixes.slice(0, 12).map((f) => ({
          priority: Math.max(1, Math.min(5, Number(f.priority) || 3)),
          title: String(f.title ?? "Fix"),
          rationale: String(f.rationale ?? ""),
          timestamp:
            f.timestamp !== undefined && f.timestamp !== null
              ? Math.max(0, Math.min(totalDuration, Number(f.timestamp)))
              : undefined,
          suggestedRewrite: f.suggestedRewrite ? String(f.suggestedRewrite).slice(0, 400) : undefined,
        }))
      : [];

    const publishReady = Boolean(p.publishReady) && fixes.length === 0;

    return {
      publishReady,
      oneThingToFix: String(p.oneThingToFix ?? (publishReady ? "Publish-ready; no critical changes detected." : "Clarify the most important concept before publishing.")),
      fixes: fixes.slice(0, 3),
      accessibility: Array.isArray(p.accessibility) ? p.accessibility.map(String).slice(0, 2) : [],
      equity: Array.isArray(p.equity) ? p.equity.map(String).slice(0, 2) : [],
      clarity: Array.isArray(p.clarity) ? p.clarity.map(String).slice(0, 2) : [],
    };
  } catch {
    return {
      publishReady: false,
      oneThingToFix: "Re-run the audit; the model returned non-JSON output.",
      fixes: [{ priority: 1, title: "Parse error", rationale: "Try again. If persistent, reduce video length.", timestamp: 0 }],
      accessibility: [],
      equity: [],
      clarity: [],
    };
  }
}
