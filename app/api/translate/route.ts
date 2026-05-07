import { NextRequest, NextResponse } from "next/server";
import { translateMaterials } from "@/lib/agents/translator";
import { StudyMaterials } from "@/lib/agents/studyMaterialGenerator";

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let materials: StudyMaterials;
  let targetLanguage: string;

  try {
    const body = await req.json();
    materials = body.materials;
    targetLanguage = body.targetLanguage;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!targetLanguage || targetLanguage.trim() === "") {
    return NextResponse.json({ error: "Target language is required." }, { status: 400 });
  }

  if (!materials || !materials.summaries) {
    return NextResponse.json({ error: "No study materials provided." }, { status: 400 });
  }

  try {
    const translated = await translateMaterials(materials, targetLanguage);
    return NextResponse.json(translated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Translation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
