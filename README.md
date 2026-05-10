# Lecturemate AI

Turn YouTube lectures into a structured study workspace: outline, summaries, flashcards, quiz, insights, chat, and timestamped search. Optional Google sign-in syncs data to Supabase; guest mode stays on the device.

## Features

- **Student mode** – Process a lecture URL, watch with chapter rail, track progress, XP and daily quests.
- **Chat** – Streaming assistant (AWS Bedrock Claude) with lecture context; optional **RAG** pulls transcript chunks from Supabase pgvector when configured.
- **Find** – Question-based search with transcript grounding.
- **Faculty / Provost** – Optional audit and curriculum map flows (unlock in app).

## Stack

- **Next.js 16** (App Router), React 19, Tailwind CSS
- **AWS Bedrock** – Claude (chat, agents), Titan Text Embeddings v2 (RAG), Nova Micro (search)
- **Supabase** – Postgres, optional **pgvector** for `lecture_chunks`
- **Auth.js v5** – Google OAuth (JWT sessions)
- **LangGraph** – Retrieve-then-compose step before chat when `videoId` and vector store are available

## Prerequisites

- Node.js 20+
- AWS account with Bedrock model access (Claude, Titan Embeddings v2, and any models your agents use)
- Supabase project (for cloud sync and optional RAG)

## Setup

1. Clone and install:

   ```powershell
   git clone <your-repo-url> lecturemate-ai
   cd lecturemate-ai
   npm install
   ```

2. Environment – copy `.env.example` to `.env.local` and fill values:

   - `AWS_*` for Bedrock
   - `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` for sign-in
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and anon key if you use it client-side)

3. Database – in the Supabase SQL editor, run:

   - `supabase/schema.sql` (app tables)
   - `supabase/migrations/002_rag_lecture_chunks.sql` (only if you want RAG chat indexing)

4. Dev server:

   ```powershell
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command         | Description        |
| --------------- | ------------------ |
| `npm run dev`   | Development server |
| `npm run build` | Production build   |
| `npm run start` | Production server  |
| `npm run lint`  | ESLint             |

## Deploy

Configure the same environment variables on your host (e.g. Vercel). Ensure Bedrock is reachable from that region and Supabase RLS/service-role usage matches your API routes.

## License

Private / team use unless you add a public license.
