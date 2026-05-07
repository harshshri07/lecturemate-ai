import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, Message } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Model lineup — picked per task for the best speed/cost/quality tradeoff
export const MODEL_SONNET     = "us.anthropic.claude-sonnet-4-6";                  // quality-sensitive summaries
export const MODEL_HAIKU      = "us.anthropic.claude-haiku-4-5-20251001-v1:0";     // structured JSON (outline, cards, insights)
export const MODEL_NOVA_MICRO = "us.amazon.nova-micro-v1:0";                       // ultrafast retrieval (search)
export const MODEL_NOVA_PRO   = "us.amazon.nova-pro-v1:0";                         // multilingual translation

export async function invokeAgent(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
  model = MODEL_SONNET
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const command = new ConverseCommand({
      modelId: model,
      system: [{ text: systemPrompt }],
      messages: [{ role: "user", content: [{ text: userMessage }] }],
      inferenceConfig: { maxTokens, temperature: 0.3 },
    });

    const response = await client.send(command);
    return response.output?.message?.content?.[0]?.text ?? "";
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Bedrock request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Streaming chat — yields text chunks as they arrive from Bedrock
export async function streamChat(
  systemPrompt: string,
  messages: Message[],
  model = MODEL_SONNET
): Promise<ReadableStream<string>> {
  const command = new ConverseStreamCommand({
    modelId: model,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 1024, temperature: 0.5 },
  });

  const response = await client.send(command);

  return new ReadableStream<string>({
    async start(controller) {
      try {
        if (!response.stream) { controller.close(); return; }
        for await (const event of response.stream) {
          const text = event.contentBlockDelta?.delta?.text;
          if (text) controller.enqueue(text);
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
