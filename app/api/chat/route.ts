import { NextRequest } from "next/server";
import { streamChat } from "@/lib/bedrock";
import { Message } from "@aws-sdk/client-bedrock-runtime";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      context: {
        title: string;
        channelName: string;
        sections: { title: string; summary: string; startTime: number }[];
        shortSummary: string;
        concepts: string[];
      };
    };

    if (!messages?.length || !context) {
      return new Response("Missing messages or context", { status: 400 });
    }

    // Build rich system prompt from lecture data
    const sectionsText = context.sections
      .map((s) => `  [${Math.floor(s.startTime / 60)}:${(s.startTime % 60).toString().padStart(2, "0")}] ${s.title}: ${s.summary}`)
      .join("\n");

    const systemPrompt = `You are StudyAI, a knowledgeable study assistant helping a student understand a YouTube lecture.

LECTURE: "${context.title}" by ${context.channelName}

SUMMARY:
${context.shortSummary}

SECTIONS:
${sectionsText}

KEY CONCEPTS: ${context.concepts.join(", ")}

INSTRUCTIONS:
- Answer questions specifically about this lecture's content
- Reference section titles and timestamps (e.g., "In the section at 5:30...") when relevant
- If something wasn't covered in the lecture, say so clearly
- Keep answers concise and student-friendly — no walls of text
- Use bullet points for multi-part answers
- If a student seems confused, break it down step by step
- You can suggest which section to rewatch if it would help`;

    // Convert to Bedrock Message format
    const bedrockMessages: Message[] = messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    const stream = await streamChat(systemPrompt, bedrockMessages);

    // Convert string stream to text/event-stream
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(encoder.encode(value));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chat failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
