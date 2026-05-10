import { invokeAgent, MODEL_NOVA_MICRO } from "../bedrock";
import { StructuredLecture } from "./structurer";

export interface SearchResult {
  timestamp: number;
  excerpt: string;
  confidence: "high" | "medium" | "low";
  context: string;
  sectionTitle: string;
}

const SYSTEM_PROMPT = `You are a strict retrieval agent for lecture transcripts.

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no extra text.
- Never use em dashes. Use commas, periods, or colons instead.
- You must ONLY cite moments that actually appear in the provided section text. Do not invent connections between unrelated topics (example: if the student asks about a programming language and the lecture is about motivation, that is NOT a match).
- If the lecture does not contain material that directly addresses the question, set confidence to "low", pick timestamp 0, and explain clearly in excerpt that this topic was not found in the lecture.
- If the material is only loosely related, use confidence "low" or "medium", never "high".
- Reserve "high" for when the excerpt clearly answers the question with content from that moment.`;

/** Common English words that appear in almost any lecture; not used for grounding. */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "way", "who", "did", "let", "put", "say", "she", "too", "use", "what", "when", "where", "which", "while", "with", "have", "from", "that", "this", "they", "them", "than", "then", "some", "such", "into", "just", "also", "even", "most", "much", "very", "well", "were", "been", "being", "both", "each", "made", "make", "many", "more", "only", "other", "over", "same", "such", "these", "think", "those", "time", "very", "will", "with", "about", "after", "again", "before", "could", "every", "first", "great", "might", "never", "really", "right", "should", "still", "their", "there", "under", "would",   "lecture", "video", "talk", "section", "chapter", "explain", "describe", "discuss", "topic", "main", "idea", "concept", "summary",
  "thing", "things", "stuff", "point", "points", "part", "parts", "kind", "sort", "question", "answer", "find", "search", "tell", "give", "show",
]);

/** Short tokens that are still meaningful for tech / topics. */
const SHORT_TECH = new Set([
  "ai", "ml", "sql", "gpu", "rag", "api", "ui", "ux", "js", "ts", "io", "go", "cs", "os", "pc",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match in longer haystack (Latin letters + digits). */
function wordMatchesInText(word: string, haystack: string): boolean {
  const w = word.toLowerCase();
  if (w.length === 0) return false;
  const h = haystack.toLowerCase();
  if (SHORT_TECH.has(w)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(w)}([^a-z0-9]|$)`, "i").test(h);
  }
  if (w.length < 4) return false;
  return new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(h);
}

function extractSubstantiveTokens(question: string): string[] {
  const raw = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const t of raw) {
    if (STOPWORDS.has(t)) continue;
    if (SHORT_TECH.has(t)) {
      out.push(t);
      continue;
    }
    if (t.length >= 4) out.push(t);
  }
  return Array.from(new Set(out));
}

function buildCorpus(lecture: StructuredLecture): string {
  return lecture.sections
    .map((s) => `${s.title}\n${s.summary}\n${s.rawText}`)
    .join("\n");
}

function notFoundResult(lecture: StructuredLecture, reason: string): SearchResult {
  const first = lecture.sections[0];
  return {
    timestamp: 0,
    excerpt: reason,
    confidence: "low",
    context: "No transcript evidence matched your search terms. Try a phrase that appears in the lecture or ask about themes you see in the outline.",
    sectionTitle: first?.title ?? "",
  };
}

function validateAgainstTokens(
  tokens: string[],
  excerpt: string,
  context: string,
  sectionTitle: string,
  rawAtSection: string
): boolean {
  const bundle = `${excerpt} ${context} ${sectionTitle} ${rawAtSection}`;
  return tokens.every((t) => wordMatchesInText(t, bundle));
}

export async function semanticSearch(
  question: string,
  lecture: StructuredLecture
): Promise<SearchResult> {
  const q = question.trim();
  const tokens = extractSubstantiveTokens(q);
  const corpus = buildCorpus(lecture);

  if (tokens.length > 0) {
    const everyTokenInLecture = tokens.every((t) => wordMatchesInText(t, corpus));
    if (!everyTokenInLecture) {
      return notFoundResult(
        lecture,
        "This lecture does not contain all of your search terms in the transcript. Try fewer keywords, different wording, or check the outline for what is actually covered."
      );
    }
  }

  const transcriptSummary = lecture.sections
    .map((s) => `[${s.startTime}s - ${s.endTime}s] "${s.title}": ${s.summary} | Excerpt: ${s.rawText.slice(0, 500)}`)
    .join("\n\n");

  const truncated = transcriptSummary.length > 12000
    ? transcriptSummary.slice(0, 12000) + "..."
    : transcriptSummary;

  const groundingHint =
    tokens.length > 0
      ? `The following search terms DO appear somewhere in the lecture text: ${tokens.join(", ")}. Your excerpt must reflect those terms or clearly related wording from the same passage.`
      : "The question is general. Pick the best matching moment from the text above.";

  const userMessage = `Student question: "${q}"

Lecture: "${lecture.title}"
Sections:
${truncated}

${groundingHint}

Find the single best moment that answers the question using ONLY the passages above. Return JSON in exactly this format:
{
  "timestamp": 874,
  "excerpt": "Quote or tight paraphrase taken from the lecture text above",
  "confidence": "high",
  "context": "One sentence: why this moment answers the question",
  "sectionTitle": "The section title where this is found"
}

Rules:
- timestamp must be an integer in seconds and fall inside that section's time range.
- If nothing in the lecture answers the question, use timestamp 0, confidence "low", and say so in excerpt.
- confidence must be "high", "medium", or "low". Use "high" only when the excerpt clearly answers the question.
- excerpt should be 1-3 sentences grounded in the provided text.`;

  const raw = await invokeAgent(SYSTEM_PROMPT, userMessage, 700, MODEL_NOVA_MICRO);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as SearchResult;

    let confidence = (["high", "medium", "low"].includes(parsed.confidence)
      ? parsed.confidence
      : "medium") as "high" | "medium" | "low";

    const ts = Number(parsed.timestamp) ?? 0;
    let sectionTitle = parsed.sectionTitle ?? lecture.sections[0]?.title ?? "";

    let rawAtSection = "";
    for (const s of lecture.sections) {
      if (ts >= s.startTime && ts <= s.endTime) {
        sectionTitle = s.title;
        rawAtSection = s.rawText;
        break;
      }
    }
    if (!rawAtSection && lecture.sections.length > 0) {
      const nearest = lecture.sections.reduce((best, s) =>
        Math.abs(ts - s.startTime) < Math.abs(ts - best.startTime) ? s : best
      );
      rawAtSection = nearest.rawText;
      sectionTitle = nearest.title;
    }

    if (tokens.length > 0) {
      const bundleOk = validateAgainstTokens(
        tokens,
        parsed.excerpt ?? "",
        parsed.context ?? "",
        sectionTitle,
        rawAtSection
      );
      if (!bundleOk) {
        confidence = "low";
      }
    }

    if (tokens.length > 0 && confidence === "high") {
      const termsInCorpus = tokens.filter((t) => wordMatchesInText(t, corpus));
      const termsInAnswer = tokens.filter((t) =>
        wordMatchesInText(t, `${parsed.excerpt ?? ""} ${parsed.context ?? ""} ${rawAtSection}`)
      );
      if (termsInCorpus.length > 0 && termsInAnswer.length === 0) {
        confidence = "low";
      }
    }

    return {
      timestamp: ts,
      excerpt: parsed.excerpt ?? "No relevant excerpt found.",
      confidence,
      context: parsed.context ?? "",
      sectionTitle,
    };
  } catch {
    return {
      timestamp: 0,
      excerpt: "Could not find a specific answer. Please review the full lecture.",
      confidence: "low",
      context: "Search failed to parse a precise result.",
      sectionTitle: lecture.sections[0]?.title ?? "Introduction",
    };
  }
}
