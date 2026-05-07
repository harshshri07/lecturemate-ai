import { NextRequest, NextResponse } from "next/server";
import { semanticSearch } from "@/lib/agents/semanticSearch";
import { StructuredLecture } from "@/lib/agents/structurer";

const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let question: string;
  let lecture: StructuredLecture;

  try {
    const body = await req.json();
    question = body.question;
    lecture = body.lecture;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!question || question.trim().length < 3) {
    return NextResponse.json({ error: "Please enter a question (at least 3 characters)." }, { status: 400 });
  }

  if (!lecture || !lecture.sections) {
    return NextResponse.json({ error: "No lecture data provided." }, { status: 400 });
  }

  try {
    const result = await semanticSearch(question.trim(), lecture);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
