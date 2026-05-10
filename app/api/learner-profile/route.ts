import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import type { LearnerProfile } from "@/app/lib/adaptLevel";
import { adaptLevel, levelToTone, scoreToLevel } from "@/app/lib/adaptLevel";
import { getDbLearnerProfile, upsertDbLearnerProfile } from "@/app/lib/db";

// ── GET /api/learner-profile ─────────────────────────────────────────────────
// Returns the signed-in user's learner profile from Supabase.
// Returns 401 if not authenticated (client falls back to localStorage).

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const row = await getDbLearnerProfile(session.user.id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const profile: LearnerProfile = {
      id:                  row.user_id,
      overallLevel:        row.overall_level as LearnerProfile["overallLevel"],
      quizHistory:         (row.quiz_history ?? []) as LearnerProfile["quizHistory"],
      chatTone:            row.chat_tone as LearnerProfile["chatTone"],
      checkedInLectures:   row.checked_in_lectures ?? [],
    };
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// ── POST /api/learner-profile ────────────────────────────────────────────────
// Body: Partial<LearnerProfile> + optional newQuizScore
// Creates or merges. Requires auth — unauthenticated users use localStorage only.

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json() as Partial<LearnerProfile> & { newQuizScore?: number };
    const { newQuizScore, ...patch } = body;

    // Load existing from DB (or start fresh)
    const existing = await getDbLearnerProfile(session.user.id);
    const base: LearnerProfile = existing
      ? {
          id:                 existing.user_id,
          overallLevel:       existing.overall_level as LearnerProfile["overallLevel"],
          quizHistory:        (existing.quiz_history ?? []) as LearnerProfile["quizHistory"],
          chatTone:           existing.chat_tone as LearnerProfile["chatTone"],
          checkedInLectures:  existing.checked_in_lectures ?? [],
        }
      : {
          id:                 session.user.id,
          overallLevel:       "intermediate",
          quizHistory:        [],
          chatTone:           "peer-level",
          checkedInLectures:  [],
        };

    // Merge patch
    const merged: LearnerProfile = {
      ...base,
      ...patch,
      quizHistory:        patch.quizHistory ?? base.quizHistory,
      checkedInLectures:  patch.checkedInLectures ?? base.checkedInLectures,
    };

    // Recompute level if a new quiz score was submitted
    if (typeof newQuizScore === "number") {
      const historyEntry = {
        videoId:   patch.checkedInLectures?.at(-1) ?? "",
        score:     newQuizScore,
        level:     scoreToLevel(newQuizScore),
        timestamp: Date.now(),
      };
      merged.quizHistory   = [historyEntry, ...merged.quizHistory].slice(0, 50);
      merged.overallLevel  = adaptLevel(merged, newQuizScore);
      merged.chatTone      = levelToTone(merged.overallLevel);
    }

    await upsertDbLearnerProfile(session.user.id, merged);
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json({ ok: true, dbPending: true });
  }
}
