import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDbLectureProgress, upsertDbLectureProgress } from "@/app/lib/db";

// ── GET /api/lecture-progress?videoId=<id> ───────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "Missing videoId" }, { status: 400 });

  try {
    const row = await getDbLectureProgress(session.user.id, videoId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row.data);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// ── POST /api/lecture-progress ───────────────────────────────────────────────
// Body: { videoId: string; data: LectureProgress }

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json() as { videoId: string; data: Record<string, unknown> };
    if (!body.videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    await upsertDbLectureProgress(session.user.id, body.videoId, body.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true, dbPending: true });
  }
}
