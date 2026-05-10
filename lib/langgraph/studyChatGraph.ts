import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { retrieveLectureContext } from "@/lib/rag/vectorStore";

export type LectureChatContext = {
  title: string;
  channelName: string;
  sections: { title: string; summary: string; startTime: number }[];
  shortSummary: string;
  concepts: string[];
};

const StudyChatState = Annotation.Root({
  messages: Annotation<{ role: string; content: string }[]>(),
  videoId: Annotation<string>(),
  skillLevel: Annotation<string | undefined>(),
  context: Annotation<LectureChatContext>(),
  retrievalContext: Annotation<string>(),
  systemPrompt: Annotation<string>(),
});

function skillLevelInstructions(skillLevel?: string): string {
  if (skillLevel === "beginner") {
    return "\n- STUDENT LEVEL: Beginner. Explain every concept as if to a first-year student. Use plain language and analogies. Avoid jargon; if you must use a term, define it immediately.";
  }
  if (skillLevel === "advanced") {
    return "\n- STUDENT LEVEL: Advanced. Be precise and technical. You may use domain terminology freely. After answering, add a follow-up question or suggest a deeper angle to explore.";
  }
  return "\n- STUDENT LEVEL: Intermediate. Assume basic familiarity with the topic. Be concise, skip trivial definitions unless asked.";
}

export function buildStudyAISystemPrompt(
  context: LectureChatContext,
  skillLevel: string | undefined,
  retrievalContext: string
): string {
  const sectionsText = context.sections
    .map((s) => `  [${Math.floor(s.startTime / 60)}:${(s.startTime % 60).toString().padStart(2, "0")}] ${s.title}: ${s.summary}`)
    .join("\n");

  const ragBlock =
    retrievalContext.trim().length > 0
      ? `TRANSCRIPT EXCERPTS (retrieved for this question; cite these when relevant):\n${retrievalContext}\n`
      : "";

  return `You are StudyAI, a knowledgeable study assistant helping a student understand a YouTube lecture.

LECTURE: "${context.title}" by ${context.channelName}

SUMMARY:
${context.shortSummary}

${ragBlock}SECTION OUTLINE:
${sectionsText}

KEY CONCEPTS: ${context.concepts.join(", ")}

INSTRUCTIONS:
- Prefer facts grounded in the TRANSCRIPT EXCERPTS when they are present; use the outline for navigation.
- Answer questions specifically about this lecture's content.
- Reference section titles and timestamps when relevant.
- If something was not covered in the excerpts or outline, say so clearly.
- Keep answers concise and student-friendly. No walls of text.
- Use bullet points for multi-part answers.
- If a student seems confused, break it down step by step.
- You can suggest which section to rewatch if it would help.
- NEVER use em dashes (the long dash character). Use commas, periods, or colons instead${skillLevelInstructions(skillLevel)}`;
}

async function retrieveNode(state: typeof StudyChatState.State): Promise<Partial<typeof StudyChatState.Update>> {
  const last = [...state.messages].reverse().find((m) => m.role === "user");
  const q = last?.content ?? "";
  const retrieved = await retrieveLectureContext(state.videoId, q, 8);
  return { retrievalContext: retrieved };
}

async function composeNode(state: typeof StudyChatState.State): Promise<Partial<typeof StudyChatState.Update>> {
  const prompt = buildStudyAISystemPrompt(state.context, state.skillLevel, state.retrievalContext);
  return { systemPrompt: prompt };
}

let compiledGraph: ReturnType<typeof buildCompiledGraph> | null = null;

function buildCompiledGraph() {
  return new StateGraph(StudyChatState)
    .addNode("retrieve", retrieveNode)
    .addNode("compose", composeNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "compose")
    .addEdge("compose", END)
    .compile();
}

export async function runStudyChatGraph(input: {
  messages: { role: string; content: string }[];
  videoId: string;
  skillLevel?: string;
  context: LectureChatContext;
}): Promise<{ systemPrompt: string; retrievalContext: string }> {
  if (!compiledGraph) compiledGraph = buildCompiledGraph();

  const result = await compiledGraph.invoke({
    messages: input.messages,
    videoId: input.videoId,
    skillLevel: input.skillLevel,
    context: input.context,
    retrievalContext: "",
    systemPrompt: "",
  });

  return {
    systemPrompt: result.systemPrompt ?? "",
    retrievalContext: result.retrievalContext ?? "",
  };
}
