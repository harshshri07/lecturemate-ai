import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { embedText, embeddingToPgLiteral } from "./embeddings";

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export function isRagConfigured(): boolean {
  return Boolean(getSupabase());
}

/** Bounded parallel Titan calls — faster than strict serial, avoids hammering Bedrock. */
const EMBED_CONCURRENCY = 8;

async function embedTextsWithConcurrency(texts: string[]): Promise<number[][]> {
  const results: number[][] = new Array(texts.length);
  let next = 0;
  const workers = Math.min(EMBED_CONCURRENCY, Math.max(1, texts.length));

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= texts.length) return;
      results[i] = await embedText(texts[i]);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function indexLectureForRag(videoId: string, chunks: { content: string; startTimeSeconds: number; sectionTitle: string; chunkIndex: number }[]): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb || chunks.length === 0) return { ok: false, error: "RAG not configured or empty lecture" };

  try {
    await sb.from("lecture_chunks").delete().eq("video_id", videoId);

    const embeddings = await embedTextsWithConcurrency(chunks.map((c) => c.content));

    const rows = chunks.map((c, i) => ({
      video_id: videoId,
      chunk_index: c.chunkIndex,
      content: c.content,
      start_time_seconds: c.startTimeSeconds,
      section_title: c.sectionTitle,
      embedding: embeddings[i],
    }));

    const { error } = await sb.from("lecture_chunks").upsert(rows, {
      onConflict: "video_id,chunk_index",
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "index failed";
    return { ok: false, error: msg };
  }
}

export async function retrieveLectureContext(videoId: string, query: string, matchCount = 8): Promise<string> {
  const sb = getSupabase();
  if (!sb || !query.trim()) return "";

  try {
    const embedding = await embedText(query);
    const literal = embeddingToPgLiteral(embedding);

    const { data, error } = await sb.rpc("match_lecture_chunks", {
      p_query_embedding: literal,
      p_video_id: videoId,
      p_match_count: matchCount,
    });

    if (error || !Array.isArray(data) || data.length === 0) return "";

    const lines = (data as { content: string; start_time_seconds: number; section_title: string; similarity: number }[])
      .map((row) => {
        const t = Math.floor(row.start_time_seconds);
        const mm = Math.floor(t / 60);
        const ss = t % 60;
        const ts = `${mm}:${ss.toString().padStart(2, "0")}`;
        return `[${ts}] ${row.section_title} (score ${(row.similarity ?? 0).toFixed(2)})\n${row.content}`;
      });

    return lines.join("\n\n---\n\n");
  } catch {
    return "";
  }
}
