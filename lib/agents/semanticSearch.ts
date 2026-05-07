import { invokeAgent, MODEL_NOVA_MICRO } from "../bedrock";
import { StructuredLecture } from "./structurer";

export interface SearchResult {
  timestamp: number;
  excerpt: string;
  confidence: "high" | "medium" | "low";
  context: string;
  sectionTitle: string;
}

const SYSTEM_PROMPT = `You are a precise retrieval agent. Given a student's question and a structured lecture transcript, return the single most relevant timestamp and a short excerpt that answers it. Be exact. Return ONLY valid JSON with no markdown, no code fences, no extra text.`;

export async function semanticSearch(
  question: string,
  lecture: StructuredLecture
): Promise<SearchResult> {
  const transcriptSummary = lecture.sections
    .map((s) => `[${s.startTime}s - ${s.endTime}s] "${s.title}": ${s.summary} | Excerpt: ${s.rawText.slice(0, 300)}`)
    .join("\n\n");

  const truncated = transcriptSummary.length > 8000
    ? transcriptSummary.slice(0, 8000) + "..."
    : transcriptSummary;

  const userMessage = `Student question: "${question}"

Lecture: "${lecture.title}"
Sections:
${truncated}

Find the most relevant moment. Return JSON in exactly this format:
{
  "timestamp": 874,
  "excerpt": "The exact or paraphrased text from the transcript that answers the question",
  "confidence": "high",
  "context": "Brief explanation of why this moment answers the question",
  "sectionTitle": "The section title where this is found"
}

- timestamp must be an integer in seconds
- confidence must be "high", "medium", or "low"
- excerpt should be 1-3 sentences from or about that moment`;

  const raw = await invokeAgent(SYSTEM_PROMPT, userMessage, 512, MODEL_NOVA_MICRO);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as SearchResult;
    return {
      timestamp: Number(parsed.timestamp) ?? 0,
      excerpt: parsed.excerpt ?? "No relevant excerpt found.",
      confidence: (["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium") as "high" | "medium" | "low",
      context: parsed.context ?? "",
      sectionTitle: parsed.sectionTitle ?? lecture.sections[0]?.title ?? "",
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
