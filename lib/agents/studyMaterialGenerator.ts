import { invokeAgent } from "../bedrock";
import { StructuredLecture } from "./structurer";

export interface Flashcard {
  question: string;
  answer: string;
  timestamp: number;
  sectionTitle: string;
}

export interface StudyMaterials {
  summaries: {
    short: string;
    medium: string;
    full: string;
  };
  flashcards: Flashcard[];
  concepts: string[];
}

const SYSTEM_PROMPT = `You are a study coach. Given structured lecture sections, generate flashcards, multi-depth summaries, and key concepts, always citing the source timestamp. Return ONLY valid JSON with no markdown, no code fences, no extra explanation. IMPORTANT: Never use em dashes (the long dash character) in any text. Use commas, periods, or colons instead.`;

export async function generateStudyMaterials(
  lecture: StructuredLecture
): Promise<StudyMaterials> {
  const sectionsJson = JSON.stringify(
    lecture.sections.map((s) => ({
      title: s.title,
      startTime: s.startTime,
      endTime: s.endTime,
      summary: s.summary,
      rawText: s.rawText.slice(0, 800),
    }))
  );

  const truncatedSections = sectionsJson.length > 10000
    ? sectionsJson.slice(0, 10000) + "...]"
    : sectionsJson;

  const userMessage = `Lecture title: "${lecture.title}"
Duration: ${lecture.duration} seconds
Number of sections: ${lecture.sections.length}

Sections JSON:
${truncatedSections}

Generate study materials in exactly this JSON format:
{
  "summaries": {
    "short": "A punchy 90-second read summary (150-200 words) covering the main takeaway",
    "medium": "A 5-minute read summary (500-600 words) with key points from each section",
    "full": "A comprehensive summary (1000-1200 words) covering all sections in depth"
  },
  "flashcards": [
    {
      "question": "Clear, specific question testing understanding of a concept",
      "answer": "Concise, complete answer (1-2 sentences max)",
      "timestamp": 0,
      "sectionTitle": "Section name"
    }
  ],
  "concepts": ["key concept 1", "key concept 2", "..."]
}

Requirements:
- Create 12-20 flashcards spread across different sections. Each must be unique and non-repetitive.
- Questions should test real understanding, not just recall. Include "why", "how", and "what happens when" questions.
- Answers must be concise (1-2 sentences) so they work well as quiz options.
- Make sure each flashcard answer is distinct from other answers (no two answers should be too similar).
- Timestamp for each flashcard must be the startTime of its section (integer seconds)
- List 10-15 key concepts as short strings
- All summaries must be substantive and accurate`;

  const raw = await invokeAgent(SYSTEM_PROMPT, userMessage);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as StudyMaterials;

    return {
      summaries: {
        short: parsed.summaries?.short ?? "Summary not available.",
        medium: parsed.summaries?.medium ?? "Summary not available.",
        full: parsed.summaries?.full ?? "Summary not available.",
      },
      flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
    };
  } catch {
    return {
      summaries: {
        short: `This lecture titled "${lecture.title}" covers ${lecture.sections.length} main topics.`,
        medium: lecture.sections.map((s) => `**${s.title}**: ${s.summary}`).join("\n\n"),
        full: lecture.sections.map((s) => `## ${s.title}\n${s.summary}`).join("\n\n"),
      },
      flashcards: lecture.sections.slice(0, 5).map((s, i) => ({
        question: `What does "${s.title}" cover in this lecture?`,
        answer: s.summary,
        timestamp: s.startTime,
        sectionTitle: s.title,
      })),
      concepts: lecture.sections.map((s) => s.title),
    };
  }
}
