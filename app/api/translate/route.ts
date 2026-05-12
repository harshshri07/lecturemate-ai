import { NextRequest, NextResponse } from "next/server";
import { invokeAgent, MODEL_HAIKU } from "@/lib/bedrock";

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  pt: "Portuguese",
  ar: "Arabic",
  ko: "Korean",
  it: "Italian",
};

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please try again later." },
      { status: 429 }
    );
  }

  let body: { content: unknown; targetLang: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { content, targetLang } = body;
  const langName = SUPPORTED_LANGUAGES[targetLang];
  if (!langName) {
    return NextResponse.json(
      { error: `Unsupported language code: ${targetLang}` },
      { status: 400 }
    );
  }

  const isString = typeof content === "string";
  const contentStr = isString ? content : JSON.stringify(content, null, 2);

  // Scale tokens to content size
  const estimatedTokens = Math.ceil(contentStr.length / 3.5);
  const maxTokens = Math.min(2048, Math.max(400, estimatedTokens * 1.3 | 0));

  // Use a dead-simple prompt for plain text — the JSON-aware prompt confuses
  // Claude into hallucinating JSON structure when the input is just a paragraph.
  const sys = isString
    ? `Translate the following text to ${langName}. Return ONLY the translated text. Do not add explanations, JSON, bullet points, or any structure that was not in the original.`
    : `You are a precise translator. Translate all human-readable text to ${langName}.
Rules:
- Preserve all JSON keys exactly as-is (do NOT translate keys like "question", "answer", "short", "text", etc.)
- Preserve all JSON structure, brackets, quotes, and punctuation
- Preserve Markdown formatting (**, -, ##, etc.)
- Translate only the string values
- Return ONLY the translated JSON, nothing else`;

  try {
    const raw = await invokeAgent(sys, contentStr, maxTokens, MODEL_HAIKU);

    // For JSON input: parse the translated response back to an object/array
    if (!isString) {
      try {
        const jsonMatch = raw.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          return NextResponse.json({ translated: JSON.parse(jsonMatch[0]) });
        }
      } catch {
        // Fall through and return as string
      }
    }

    return NextResponse.json({ translated: raw });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed.";
    console.error("[translate] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
