/**
 * app/lib/db.ts
 *
 * Supabase client + typed helpers for all data tables.
 * All functions are server-side only (use service-role key).
 * The public-facing API routes call these helpers after verifying the session.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { LearnerProfile } from "@/app/lib/adaptLevel";

// ── Supabase client (service-role — bypasses RLS) ───────────────────────────
// Only import/use this on the server (API routes / Server Components).

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Lazy singleton so we don't recreate the client on every call in dev
let _serviceClient: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_serviceClient) _serviceClient = getServiceClient();
  return _serviceClient;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface DbSavedLecture {
  id: string;            // YouTube videoId
  user_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string | null;
  result: Record<string, unknown>;
  study_materials: Record<string, unknown>;
  chat_history: unknown[];
  saved_at: string;      // ISO timestamp
}

export interface DbLectureProgress {
  video_id: string;
  user_id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

export interface DbLearnerProfile {
  id: string;
  user_id: string;
  overall_level: string;
  quiz_history: unknown[];
  chat_tone: string;
  checked_in_lectures: string[];
  updated_at: string;
}

// ── Learner Profile ─────────────────────────────────────────────────────────

export async function getDbLearnerProfile(userId: string): Promise<DbLearnerProfile | null> {
  const { data, error } = await db()
    .from("learner_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDbLearnerProfile(
  userId: string,
  profile: Omit<LearnerProfile, "id">
): Promise<DbLearnerProfile> {
  const row = {
    user_id:              userId,
    overall_level:        profile.overallLevel,
    quiz_history:         profile.quizHistory,
    chat_tone:            profile.chatTone,
    checked_in_lectures:  profile.checkedInLectures,
    updated_at:           new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("learner_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Saved Lectures ──────────────────────────────────────────────────────────

export async function getDbSavedLectures(userId: string): Promise<DbSavedLecture[]> {
  const { data, error } = await db()
    .from("saved_lectures")
    .select("*")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getDbSavedLecture(
  userId: string,
  videoId: string
): Promise<DbSavedLecture | null> {
  const { data, error } = await db()
    .from("saved_lectures")
    .select("*")
    .eq("user_id", userId)
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDbSavedLecture(
  userId: string,
  lecture: {
    id: string;
    title: string;
    channelName: string;
    thumbnailUrl?: string;
    result: Record<string, unknown>;
    studyMaterials: Record<string, unknown>;
    chatHistory?: unknown[];
  }
): Promise<DbSavedLecture> {
  const row = {
    id:              lecture.id,
    user_id:         userId,
    title:           lecture.title,
    channel_name:    lecture.channelName,
    thumbnail_url:   lecture.thumbnailUrl ?? null,
    result:          lecture.result,
    study_materials: lecture.studyMaterials,
    chat_history:    lecture.chatHistory ?? [],
    saved_at:        new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("saved_lectures")
    .upsert(row, { onConflict: "id,user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDbChatHistory(
  userId: string,
  videoId: string,
  chatHistory: unknown[]
): Promise<void> {
  const { error } = await db()
    .from("saved_lectures")
    .update({ chat_history: chatHistory, saved_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", videoId);
  if (error) throw error;
}

export async function deleteDbSavedLecture(
  userId: string,
  videoId: string
): Promise<void> {
  const { error } = await db()
    .from("saved_lectures")
    .delete()
    .eq("user_id", userId)
    .eq("id", videoId);
  if (error) throw error;
}

// ── Lecture Progress ────────────────────────────────────────────────────────

export async function getDbLectureProgress(
  userId: string,
  videoId: string
): Promise<DbLectureProgress | null> {
  const { data, error } = await db()
    .from("lecture_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDbLectureProgress(
  userId: string,
  videoId: string,
  progressData: Record<string, unknown>
): Promise<DbLectureProgress> {
  const row = {
    video_id:   videoId,
    user_id:    userId,
    data:       progressData,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("lecture_progress")
    .upsert(row, { onConflict: "video_id,user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
