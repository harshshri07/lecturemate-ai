-- RAG: pgvector chunks for lecture transcripts (run in Supabase SQL Editor if not using migrations tool)
-- Dimensions must match Bedrock Titan Embeddings v2 (1024)

create extension if not exists vector;

create table if not exists public.lecture_chunks (
  id                   uuid primary key default gen_random_uuid(),
  video_id             text not null,
  chunk_index          int  not null,
  content              text not null,
  start_time_seconds   double precision not null default 0,
  section_title        text not null default '',
  embedding            vector(1024) not null,
  created_at           timestamptz default now(),
  unique (video_id, chunk_index)
);

create index if not exists lecture_chunks_video_id_idx on public.lecture_chunks (video_id);

-- Cosine similarity search (embeddings are normalized from Titan)
create index if not exists lecture_chunks_embedding_idx
  on public.lecture_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.lecture_chunks enable row level security;

create policy "service_role bypass lecture_chunks"
  on public.lecture_chunks for all using (true) with check (true);

-- Accept embedding as JSON array string for PostgREST compatibility
create or replace function public.match_lecture_chunks(
  p_query_embedding text,
  p_video_id text,
  p_match_count int default 8
)
returns table (
  content text,
  start_time_seconds double precision,
  section_title text,
  similarity float
)
language sql
stable
as $$
  select
    c.content,
    c.start_time_seconds,
    c.section_title,
    (1 - (c.embedding <=> (p_query_embedding::vector)))::float as similarity
  from public.lecture_chunks c
  where c.video_id = p_video_id
  order by c.embedding <=> (p_query_embedding::vector)
  limit least(coalesce(p_match_count, 8), 24);
$$;
