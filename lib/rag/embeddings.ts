import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "amazon.titan-embed-text-v2:0";
const DIMENSIONS = 1024;

function getClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Titan Text Embeddings V2 — normalized vectors for cosine similarity in pgvector.
 */
export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!trimmed) {
    return Array.from({ length: DIMENSIONS }, () => 0);
  }

  const client = getClient();
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(
      JSON.stringify({
        inputText: trimmed,
        dimensions: DIMENSIONS,
        normalize: true,
      })
    ),
  });

  const response = await client.send(command);
  const raw = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(raw) as { embedding?: number[] };
  const emb = parsed.embedding;
  if (!Array.isArray(emb) || emb.length !== DIMENSIONS) {
    throw new Error("Unexpected embedding shape from Titan");
  }
  return emb;
}

export function embeddingToPgLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
