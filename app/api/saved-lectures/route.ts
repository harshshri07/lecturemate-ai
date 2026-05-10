import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getDbSavedLectures,
  upsertDbSavedLecture,
  deleteDbSavedLecture,
  updateDbChatHistory,
} from "@/app/lib/db";

// ── GET /api/saved-lectures ──────────────────────────────────────────────────
// Returns all saved lectures for the signed-in user.

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const rows = await getDbSavedLectures(session.user.id);
    const lectures = rows.map((row) => ({
      id:             row.id,
      title:          row.title,
      channelName:    row.channel_name,
      thumbnailUrl:   row.thumbnail_url ?? "",
      savedAt:        new Date(row.saved_at).getTime(),
      result:         row.result,
      studyMaterials: row.study_materials,
      chatHistory:    row.chat_history ?? [],
    }));
    return NextResponse.json(lectures);
  } catch {
    // DB not set up yet — return empty list so client falls back to localStorage
    return NextResponse.json([]);
  }
}

// ── POST /api/saved-lectures ─────────────────────────────────────────────────
// Body: SavedLecture — upserts a lecture.
// Also handles chat history updates when body contains chatHistoryOnly:true.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      id: string;
      title?: string;
      channelName?: string;
      thumbnailUrl?: string;
      result?: Record<string, unknown>;
      studyMaterials?: Record<string, unknown>;
      chatHistory?: unknown[];
      chatHistoryOnly?: boolean;
    };

    if (!body.id) {
      return NextResponse.json({ error: "Missing lecture id" }, { status: 400 });
    }

    if (body.chatHistoryOnly) {
      // Lightweight update — only persist new chat messages
      await updateDbChatHistory(session.user.id, body.id, body.chatHistory ?? []);
      return NextResponse.json({ ok: true });
    }

    // Full upsert
    const row = await upsertDbSavedLecture(session.user.id, {
      id:             body.id,
      title:          body.title ?? "",
      channelName:    body.channelName ?? "",
      thumbnailUrl:   body.thumbnailUrl,
      result:         body.result ?? {},
      studyMaterials: body.studyMaterials ?? {},
      chatHistory:    body.chatHistory ?? [],
    });

    return NextResponse.json({
      id:             row.id,
      title:          row.title,
      channelName:    row.channel_name,
      thumbnailUrl:   row.thumbnail_url ?? "",
      savedAt:        new Date(row.saved_at).getTime(),
      result:         row.result,
      studyMaterials: row.study_materials,
      chatHistory:    row.chat_history ?? [],
    });
  } catch {
    // DB not set up yet — return ok so client doesn't retry indefinitely
    return NextResponse.json({ ok: true, dbPending: true });
  }
}

// ── DELETE /api/saved-lectures?id=<videoId> ──────────────────────────────────

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    await deleteDbSavedLecture(session.user.id, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true, dbPending: true });
  }
}
