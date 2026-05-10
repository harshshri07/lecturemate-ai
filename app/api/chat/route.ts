import { NextRequest } from "next/server";
import { streamChat } from "@/lib/bedrock";
import { Message } from "@aws-sdk/client-bedrock-runtime";
import { buildStudyAISystemPrompt, runStudyChatGraph } from "@/lib/langgraph/studyChatGraph";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages, context, skillLevel, videoId } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      videoId?: string;
      context: {
        title: string;
        channelName: string;
        sections: { title: string; summary: string; startTime: number }[];
        shortSummary: string;
        concepts: string[];
      };
      skillLevel?: "beginner" | "intermediate" | "advanced";
    };

    if (!messages?.length || !context) {
      return new Response("Missing messages or context", { status: 400 });
    }

    let systemPrompt: string;
    if (videoId && typeof videoId === "string") {
      const out = await runStudyChatGraph({
        messages,
        videoId,
        skillLevel,
        context,
      });
      systemPrompt = out.systemPrompt;
    } else {
      systemPrompt = buildStudyAISystemPrompt(context, skillLevel, "");
    }

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
