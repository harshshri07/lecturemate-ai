"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Brain, FileText, Search, Layers,
  Plus, Play, Check, Loader2, ChevronLeft, ChevronRight,
  Quote, Sparkles, List, CheckCircle2, Clock,
  Zap, Coffee, Target, GraduationCap, BookOpen, Headphones,
  Trophy, RotateCcw, Star, X, MessageCircle, Send, LineChart, UserRound, Trash2,
  Languages,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { StructuredLecture } from "@/lib/agents/structurer";
import type { TranscriptEntry, VideoMetadata } from "@/lib/youtube";
import { StudyMaterials, sortFlashcardsChronologically } from "@/lib/agents/studyMaterialGenerator";
import { SearchResult } from "@/lib/agents/semanticSearch";
import { LectureInsights } from "@/lib/agents/insights";
import {
  FACULTY_DEFAULT_PUBLICATION_READY,
  type FacultyAuditReport,
} from "@/lib/agents/facultyAudit";
import type { CurriculumMapReport, ObjectiveCoverageRow } from "@/lib/agents/curriculumMap";
import { Mascot } from "@/app/components/Mascot";
import { celebrate } from "@/app/components/Confetti";
import { CheckInModal } from "@/app/components/CheckInModal";
import { XPToastContainer, type XPToastItem } from "@/app/components/XPToast";
import { SignInGate, shouldShowGate } from "@/app/components/SignInGate";
import { AnimatedBackground } from "@/app/components/AnimatedBackground";
import {
  loadXPState, awardXP, getLevelInfo,
  type XPState, type XPEvent,
} from "@/app/lib/xp";
import { canUseUrl } from "@/app/lib/guestSession";
import {
  type LearnerProfile,
  type SkillLevel,
  adaptLevel,
  levelToTone,
  loadLearnerProfile,
  saveLearnerProfile,
} from "@/app/lib/adaptLevel";

interface ProcessResult {
  videoId: string;
  metadata: VideoMetadata;
  lecture: StructuredLecture;
  studyMaterials: StudyMaterials;
  insights?: LectureInsights;
}

type PipelineStage = "idle" | "extracting" | "structuring" | "generating" | "complete" | "error";
type DashTab = "summary" | "outline" | "flashcards" | "quiz" | "insights" | "chat" | "find";
type AppMode = "student" | "faculty" | "provost";

type Achievement = { id: string; title: string; desc: string };
type LectureProgress = {
  sectionsCompleted: number[];
  cardsReviewed: number[];
  chatUsed: boolean;
  searchUsed: boolean;
  quizScore: number | null;
  weakTopics?: string[];
  focusSeconds: number;
  achievements: Achievement[];
};

const EXAMPLE_URLS = [
  { label: "Karpathy: Build GPT from scratch", url: "https://youtube.com/watch?v=kCc8FmEb1nY" },
  { label: "3Blue1Brown: Neural Networks", url: "https://youtube.com/watch?v=aircAruvnKk" },
  { label: "MIT: Intro to Deep Learning", url: "https://youtube.com/watch?v=ErnWZxJovaM" },
];


const PIPELINE_STEPS = [
  { label: "Fetching transcript from YouTube", icon: "📡" },
  { label: "AI is structuring the lecture outline", icon: "🧠" },
  { label: "Generating summaries & flashcards", icon: "✨" },
];

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Renders inline markdown: ***bi***, **bold**, *italic*, `code` */
function renderInline(text: string, key?: string): React.ReactNode {
  const clean = text.replace(/\u2014/g, ",").replace(/\u2013/g, "-");
  const parts = clean.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((chunk, i) => {
    const k = `${key ?? ""}-${i}`;
    if (chunk.startsWith("***") && chunk.endsWith("***")) return <strong key={k}><em>{chunk.slice(3, -3)}</em></strong>;
    if (chunk.startsWith("**") && chunk.endsWith("**")) return <strong key={k} style={{ fontWeight: 600, color: "var(--foreground)" }}>{chunk.slice(2, -2)}</strong>;
    if (chunk.startsWith("*") && chunk.endsWith("*") && chunk.length > 2) return <em key={k}>{chunk.slice(1, -1)}</em>;
    if (chunk.startsWith("`") && chunk.endsWith("`")) return (
      <code key={k} style={{ fontFamily: "var(--font-mono)", fontSize: "0.82em", background: "var(--surface-elevated)", padding: "0.1em 0.35em", borderRadius: "4px" }}>
        {chunk.slice(1, -1)}
      </code>
    );
    return chunk;
  });
}

/** Full block + inline markdown renderer for chat messages */
function renderChatMarkdown(text: string): React.ReactNode {
  const lines = text.replace(/\u2014/g, ",").replace(/\u2013/g, "-").split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();
    // HR
    if (/^---+$/.test(trim)) {
      nodes.push(<hr key={i} style={{ borderColor: "var(--border)", margin: "0.5rem 0" }} />);
      i++; continue;
    }
    // Headers
    const hm = trim.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      const fs = lvl === 1 ? "1rem" : lvl === 2 ? "0.95rem" : "0.9rem";
      nodes.push(<p key={i} style={{ fontWeight: 600, fontSize: fs, marginTop: "0.6rem", marginBottom: "0.15rem" }}>{renderInline(hm[2], `h${i}`)}</p>);
      i++; continue;
    }
    // Bullet list — collect consecutive items
    if (/^[-*] /.test(trim)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(<li key={i}>{renderInline(lines[i].trim().replace(/^[-*] /, ""), `li${i}`)}</li>);
        i++;
      }
      nodes.push(<ul key={`ul${i}`} style={{ paddingLeft: "1.1rem", marginBottom: "0.3rem", listStyleType: "disc" }}>{items}</ul>);
      continue;
    }
    // Numbered list
    if (/^\d+\. /.test(trim)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(<li key={i}>{renderInline(lines[i].trim().replace(/^\d+\. /, ""), `ol${i}`)}</li>);
        i++;
      }
      nodes.push(<ol key={`ol${i}`} style={{ paddingLeft: "1.1rem", marginBottom: "0.3rem", listStyleType: "decimal" }}>{items}</ol>);
      continue;
    }
    // Empty line
    if (trim === "") { nodes.push(<br key={i} />); i++; continue; }
    // Normal text
    nodes.push(<p key={i} style={{ marginBottom: "0.2rem" }}>{renderInline(line, `p${i}`)}</p>);
    i++;
  }
  return <>{nodes}</>;
}

/** Lecturemate AI logo SVG */
function LecturemateLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="var(--foreground)" />
      {/* Three neural nodes */}
      <circle cx="9" cy="13" r="2.8" fill="var(--background)" />
      <circle cx="23" cy="13" r="2.8" fill="var(--background)" />
      <circle cx="16" cy="22" r="2.8" fill="var(--background)" />
      {/* Connections */}
      <line x1="9" y1="13" x2="23" y2="13" stroke="var(--background)" strokeWidth="1.5" strokeOpacity="0.45" />
      <line x1="9" y1="13" x2="16" y2="22" stroke="var(--background)" strokeWidth="1.5" strokeOpacity="0.45" />
      <line x1="23" y1="13" x2="16" y2="22" stroke="var(--background)" strokeWidth="1.5" strokeOpacity="0.45" />
      {/* Top spark */}
      <circle cx="16" cy="6" r="1.6" fill="var(--background)" fillOpacity="0.55" />
      <line x1="9" y1="13" x2="16" y2="6" stroke="var(--background)" strokeWidth="1" strokeOpacity="0.25" />
      <line x1="23" y1="13" x2="16" y2="6" stroke="var(--background)" strokeWidth="1" strokeOpacity="0.25" />
    </svg>
  );
}

// ── localStorage helpers ────────────────────────────────────────────────
interface SavedLecture {
  id: string;                 // videoId
  title: string;
  channelName: string;
  thumbnailUrl: string;
  savedAt: number;
  result: ProcessResult;
  studyMaterials: StudyMaterials;
  chatHistory: ChatMessage[];
}

const STORAGE_KEY = "lecturemate_lectures";
const LAST_SESSION_KEY = "lecturemate_last_session";
const CREATOR_UNLOCK_KEY = "lecturemate_creator_unlocked";
const FACULTY_CACHE_KEY = "lecturemate_faculty_cache";
const PROVOST_CACHE_KEY = "lecturemate_provost_cache";
const PROGRESS_PREFIX = "lecturemate_progress:";
const MAX_SAVED = 10;
/** Recents + last-session restore expire after 7 days */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_PROGRESS: LectureProgress = {
  sectionsCompleted: [],
  cardsReviewed: [],
  chatUsed: false,
  searchUsed: false,
  quizScore: null,
  focusSeconds: 0,
  achievements: [],
};

function uniq(nums: number[]) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/** Active playback needed in a section before it counts as "explored" for XP (capped so long chapters are still reachable). */
function sectionWatchThresholdSec(sections: { startTime: number; endTime: number }[], i: number): number {
  const s = sections[i];
  const len = Math.max(1, s.endTime - s.startTime);
  const target = Math.max(15, Math.min(150, len * 0.22));
  return target;
}

function loadProgress(videoId: string): LectureProgress {
  const key = `${PROGRESS_PREFIX}${videoId}`;
  let raw = loadJson<LectureProgress>(key);
  let fromLegacy = false;
  if (!raw) {
    raw = loadJson<LectureProgress>(`studyai_progress:${videoId}`);
    fromLegacy = !!raw;
  }
  if (!raw) return DEFAULT_PROGRESS;
  const normalized: LectureProgress = {
    ...DEFAULT_PROGRESS,
    ...raw,
    sectionsCompleted: uniq(Array.isArray(raw.sectionsCompleted) ? raw.sectionsCompleted : []),
    cardsReviewed: uniq(Array.isArray((raw as any).cardsReviewed) ? (raw as any).cardsReviewed : []),
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    quizScore: typeof raw.quizScore === "number" ? raw.quizScore : null,
    focusSeconds: typeof raw.focusSeconds === "number" ? raw.focusSeconds : 0,
    chatUsed: Boolean(raw.chatUsed),
    searchUsed: Boolean(raw.searchUsed),
  };
  if (fromLegacy) saveProgress(videoId, normalized);
  return normalized;
}

function saveProgress(videoId: string, value: LectureProgress) {
  const key = `${PROGRESS_PREFIX}${videoId}`;
  saveJson(key, value);
}

function addAchievement(p: LectureProgress, a: Achievement): LectureProgress {
  if (p.achievements.some((x) => x.id === a.id)) return p;
  return { ...p, achievements: [a, ...p.achievements].slice(0, 20) };
}

function pruneExpired(entries: SavedLecture[]): SavedLecture[] {
  const now = Date.now();
  return entries.filter((e) => now - e.savedAt <= TTL_MS);
}

function pickQuote(mode: AppMode) {
  const student = [
    "You don't learn by watching. You learn by retrieving.",
    "Small summaries. Big understanding.",
    "Clarity beats speed; focus beats noise.",
    "Turn any lecture into your personal workspace.",
    "The best review session is the one you actually do.",
    "Understanding compounds. Start with the outline.",
    "Flash cards beat re-reading. Every time.",
    "One lecture, well processed, beats ten skimmed.",
    "Learn it once, recall it forever.",
    "Your future self will thank you for studying now.",
  ];
  const faculty = [
    "A great lecture is a guided path, not a stream.",
    "Signpost. Define. Recap. Publish.",
    "One improvement can double student clarity.",
    "Teach the structure, not just the content.",
    "Clear outcomes make great lectures, and vice versa.",
    "Explicit transitions: invisible when they work, priceless when missing.",
    "Accessibility is not an afterthought. It is the foundation.",
    "The best lecturers edit as obsessively as writers do.",
    "Equity in the classroom starts with equity in the explanation.",
    "What your students remember most is what you emphasised last.",
  ];
  const provost = [
    "Objectives are promises. Coverage is evidence.",
    "What's taught matters more than what's planned.",
    "Map the course. Find the gaps. Fix them.",
    "Quality assurance, grounded in real transcripts.",
    "Curriculum coherence isn't accidental. It's designed.",
    "Redundancy wastes time; gaps lose students. Find both.",
    "Evidence-based curriculum review beats intuition.",
    "Where objectives meet content, learning happens.",
    "A curriculum map is a mirror for your programme.",
    "Close the gap between intent and instruction.",
  ];
  const pool = mode === "faculty" ? faculty : mode === "provost" ? provost : student;
  return pool[Math.floor(Math.random() * pool.length)];
}
function loadJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; }
}

function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

let legacyLectureKeysMigrated = false;
function migrateLegacyLectureListKeys() {
  if (typeof window === "undefined" || legacyLectureKeysMigrated) return;
  legacyLectureKeysMigrated = true;
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const old = localStorage.getItem("studyai_lectures");
      if (old) localStorage.setItem(STORAGE_KEY, old);
    }
    if (!localStorage.getItem(LAST_SESSION_KEY)) {
      const old = localStorage.getItem("studyai_last_session");
      if (old) localStorage.setItem(LAST_SESSION_KEY, old);
    }
    if (!localStorage.getItem(FACULTY_CACHE_KEY)) {
      const old = localStorage.getItem("studyai_faculty_cache");
      if (old) localStorage.setItem(FACULTY_CACHE_KEY, old);
    }
    if (!localStorage.getItem(PROVOST_CACHE_KEY)) {
      const old = localStorage.getItem("studyai_provost_cache");
      if (old) localStorage.setItem(PROVOST_CACHE_KEY, old);
    }
    if (!localStorage.getItem(CREATOR_UNLOCK_KEY)) {
      const old = localStorage.getItem("studyai_creator_unlocked");
      if (old) localStorage.setItem(CREATOR_UNLOCK_KEY, old);
    }
  } catch { /* ignore */ }
}

function loadSavedLectures(): SavedLecture[] {
  if (typeof window === "undefined") return [];
  migrateLegacyLectureListKeys();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedLecture[];
    if (!Array.isArray(parsed)) return [];
    const pruned = pruneExpired(parsed);
    if (pruned.length !== parsed.length) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned)); } catch { /* ignore */ }
    }
    return pruned;
  } catch {
    return [];
  }
}

function saveLecture(entry: SavedLecture) {
  const all = pruneExpired(loadSavedLectures()).filter((l) => l.id !== entry.id);
  const updated = pruneExpired([entry, ...all]).slice(0, MAX_SAVED);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* storage full */ }
}

/** Merge AI insights into a saved lecture (localStorage + optional cloud upsert). */
function mergeInsightsIntoSavedLecture(videoId: string, insights: LectureInsights, syncCloud: boolean) {
  const all = loadSavedLectures();
  const idx = all.findIndex((l) => l.id === videoId);
  if (idx < 0) return;
  const row = all[idx];
  const next: SavedLecture = {
    ...row,
    savedAt: Date.now(),
    result: { ...row.result, insights },
  };
  saveLecture(next);
  if (syncCloud) {
    fetch("/api/saved-lectures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id:             next.id,
        title:          next.title,
        channelName:    next.channelName,
        thumbnailUrl:   next.thumbnailUrl,
        result:         next.result,
        studyMaterials: next.studyMaterials,
        chatHistory:    next.chatHistory ?? [],
      }),
    }).catch(() => { /* non-critical */ });
  }
}

function updateChatHistory(videoId: string, history: ChatMessage[]) {
  const all = pruneExpired(loadSavedLectures());
  const idx = all.findIndex((l) => l.id === videoId);
  if (idx === -1) return;
  all[idx].chatHistory = history;
  all[idx].savedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pruneExpired(all))); } catch { /* ignore */ }
}

function deleteSavedLecture(videoId: string) {
  const updated = loadSavedLectures().filter((l) => l.id !== videoId);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
}

function persistLastSession(videoId: string | null, tab: DashTab, mode: AppMode) {
  if (typeof window === "undefined") return;
  if (!videoId || mode !== "student") {
    try { localStorage.removeItem(LAST_SESSION_KEY); } catch { /* ignore */ }
    return;
  }
  try {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ videoId, tab, mode, savedAt: Date.now() }));
  } catch { /* ignore */ }
}
// ────────────────────────────────────────────────────────────────────────

// ── HeaderUserArea ────────────────────────────────────────────────────────
// Shows user avatar + name (signed-in) OR a compact "Sign in" button (guest).
function HeaderUserArea({ session, onSignOut, onShowGate }: { session: ReturnType<typeof useSession>["data"]; onSignOut: () => void; onShowGate: () => void }) {
  const [open, setOpen] = React.useState(false);
  if (!session) {
    return (
      <button
        onClick={onShowGate}
        className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition hover:opacity-80"
        style={{
          background: "color-mix(in oklab, var(--primary) 14%, transparent)",
          color: "var(--primary)",
          border: "1px solid color-mix(in oklab, var(--primary) 28%, transparent)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M15.5 13h-7a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1z" />
          <path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5zm0 1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path d="M12 8.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z" />
        </svg>
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }
  return (
    <div className="relative ml-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-8 px-2 rounded-lg transition hover:opacity-80"
        style={{ background: "var(--surface-elevated)", border: "1px solid var(--border)" }}
        title={session.user.name ?? session.user.email ?? "Account"}
      >
        {session.user.image ? (
          <Image src={session.user.image} alt="" width={22} height={22} className="rounded-full object-cover" />
        ) : (
          <div className="h-[22px] w-[22px] rounded-full flex items-center justify-center text-[11px] font-bold"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
            {(session.user.name ?? session.user.email ?? "?")[0].toUpperCase()}
          </div>
        )}
        <span className="hidden sm:block text-xs font-medium max-w-[90px] truncate" style={{ color: "var(--foreground)" }}>
          {session.user.name?.split(" ")[0] ?? session.user.email}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-50 w-52 rounded-xl p-1 shadow-2xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {session.user.name}
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>
                  {session.user.email}
                </p>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0" style={{ color: "oklch(0.7 0.18 145)" }}>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 10a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 7.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Cloud sync enabled</span>
              </div>
              <button
                onClick={() => { setOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition hover:opacity-70"
                style={{ color: "var(--destructive)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const isSignedIn = !!session?.user?.id;
  const userId = session?.user?.id ?? null;

  // ── Gate state: "loading" → prevents ANY flash of hero or gate ──────────
  // "loading"  — session unknown; show neutral blank screen (no flash)
  // "gate"     — show the sign-in / guest picker
  // "app"      — skip gate, go straight to the app
  const [gateState, setGateState] = useState<"loading" | "gate" | "app">("loading");

  useEffect(() => {
    // Always show the gate first for signed-out users.
    // Once a user clicks "Continue as guest" we switch to "app" for this run.
    if (isSignedIn) {
      setGateState("app");
      return;
    }
    if (sessionStatus !== "loading") {
      setGateState("gate");
    }
    // While sessionStatus === "loading" we keep gateState = "loading"
    // (blank screen, no content rendered) to avoid any flash
  }, [sessionStatus, isSignedIn]);

  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [urlWarning, setUrlWarning] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterials | null>(null);
  const [tab, setTab] = useState<DashTab>("summary");
  const theme = "dark"; // Always dark mode
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [activeSection, setActiveSection] = useState(0);
  const [savedLectures, setSavedLectures] = useState<SavedLecture[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── XP / gamification ──────────────────────────────────────────────────────
  const [xpState, setXpState] = useState<XPState>(() => loadXPState());
  const [xpToasts, setXpToasts] = useState<XPToastItem[]>([]);

  const xpStateRef = useRef<XPState>(xpState);
  xpStateRef.current = xpState;

  const giveXP = useCallback((event: XPEvent, opts?: { quizScore?: number; label?: string }) => {
    const prev = xpStateRef.current;
    const { newState, xpGained } = awardXP(prev, event, { quizScore: opts?.quizScore });
    if (xpGained > 0) {
      setXpState(newState);
      const toastLabel = opts?.label ?? event.replace(/([A-Z])/g, " $1").toLowerCase();
      const id = `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setXpToasts((t) => [...t, { id, amount: xpGained, label: toastLabel }]);
    } else {
      setXpState(newState);
    }
  }, []);
  const [appMode, setAppMode] = useState<AppMode>("student");
  const [creatorUnlocked, setCreatorUnlocked] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [facultyUrl, setFacultyUrl] = useState("");
  const [facultyLoading, setFacultyLoading] = useState(false);
  const [facultyError, setFacultyError] = useState<string | null>(null);
  const [facultyReport, setFacultyReport] = useState<FacultyAuditReport | null>(null);
  const [facultyMeta, setFacultyMeta] = useState<{ videoId: string; title: string; channelName: string } | null>(null);
  const [provostUrlsText, setProvostUrlsText] = useState("");
  const [provostObjectivesText, setProvostObjectivesText] = useState("");
  const [provostLoading, setProvostLoading] = useState(false);
  const [provostError, setProvostError] = useState<string | null>(null);
  const [provostReport, setProvostReport] = useState<CurriculumMapReport | null>(null);
  const [provostPerVideo, setProvostPerVideo] = useState<{ videoId: string; url: string; metadata?: { title: string; channelName: string }; error?: string }[] | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(() => pickQuote("student"));
  const iframeRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Learner profile (adaptive learning) ─────────────────────────────────
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);

  /** Tracks whether we've already pushed localStorage data up to Supabase this session */
  const hasMergedToCloudRef = useRef(false);

  const [lectureProgress, setLectureProgress] = useState<LectureProgress>(DEFAULT_PROGRESS);
  const ytPlayerRef = useRef<any>(null);
  const ytPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ytLastSectionRef = useRef<number>(-1);
  const ytLastPollAtRef = useRef<number>(0);
  const sectionWatchAccumRef = useRef<Record<number, number>>({});
  const resultRef = useRef<ProcessResult | null>(null);
  const lectureProgressRef = useRef<LectureProgress>(DEFAULT_PROGRESS);
  /** Transcript from `/api/process-url` only; used once to avoid re-fetching YouTube for insights. */
  const insightsTranscriptRef = useRef<TranscriptEntry[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsRetryKey, setInsightsRetryKey] = useState(0);

  useEffect(() => {
    if (!result?.videoId) return;
    const videoId = result.videoId;
    if (isSignedIn) {
      // Load from Supabase when signed in
      fetch(`/api/lecture-progress?videoId=${encodeURIComponent(videoId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setLectureProgress({
              ...DEFAULT_PROGRESS,
              ...(data as Partial<LectureProgress>),
              sectionsCompleted: uniq(Array.isArray(data.sectionsCompleted) ? data.sectionsCompleted : []),
              achievements: Array.isArray(data.achievements) ? data.achievements : [],
            });
          } else {
            // Fall back to localStorage if not in DB yet
            setLectureProgress(loadProgress(videoId));
          }
        })
        .catch(() => setLectureProgress(loadProgress(videoId)));
    } else {
      setLectureProgress(loadProgress(videoId));
    }
  }, [result?.videoId, isSignedIn]);

  // Keep refs in sync with state for use in intervals/callbacks
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    lectureProgressRef.current = lectureProgress;
  }, [lectureProgress]);

  /** Load lecture insights after the main pipeline returns (parallel path was removed for faster first paint). */
  useEffect(() => {
    const vid = result?.videoId;
    if (!vid || result?.insights) {
      setInsightsLoading(false);
      return;
    }

    setInsightsLoading(true);
    setInsightsError(null);

    const ac = new AbortController();

    void (async () => {
      const meta = result.metadata;
      const body =
        insightsTranscriptRef.current && insightsTranscriptRef.current.length > 0
          ? {
              transcript: insightsTranscriptRef.current,
              metadata: { ...meta, videoId: meta.videoId ?? vid },
            }
          : {
              videoId: vid,
              metadata: { ...meta, videoId: meta.videoId ?? vid },
            };

      try {
        const res = await fetch("/api/lecture-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Insights request failed.");
        }
        const insights = payload.insights as LectureInsights | undefined;
        if (!insights) throw new Error("Invalid insights response.");

        insightsTranscriptRef.current = null;

        setResult((prev) => (prev && prev.videoId === vid ? { ...prev, insights } : prev));
        mergeInsightsIntoSavedLecture(vid, insights, isSignedIn);
        setSavedLectures(loadSavedLectures());
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setInsightsError(e instanceof Error ? e.message : "Insights failed.");
      } finally {
        if (!ac.signal.aborted) setInsightsLoading(false);
      }
    })();

    return () => ac.abort();
  }, [result, isSignedIn, insightsRetryKey]);

  const updateLectureProgress = useCallback((patch: Partial<LectureProgress> | ((prev: LectureProgress) => LectureProgress)) => {
    if (!result?.videoId) return;
    setLectureProgress((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      const normalized: LectureProgress = {
        ...DEFAULT_PROGRESS,
        ...next,
        sectionsCompleted: uniq(next.sectionsCompleted ?? []),
        achievements: Array.isArray(next.achievements) ? next.achievements : [],
      };
      // Always save to localStorage as local cache
      saveProgress(result.videoId, normalized);
      // Also sync to Supabase when signed in (fire-and-forget)
      if (isSignedIn) {
        fetch("/api/lecture-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: result.videoId, data: normalized }),
        }).catch(() => { /* non-critical */ });
      }
      return normalized;
    });
  }, [result?.videoId, isSignedIn]);

  const xpAwardedChaptersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!result?.videoId) return;
    sectionWatchAccumRef.current = {};
    ytLastPollAtRef.current = 0;
  }, [result?.videoId]);

  useEffect(() => {
    if (!result?.videoId) return;
    xpAwardedChaptersRef.current = new Set(lectureProgress.sectionsCompleted);
  }, [result?.videoId, lectureProgress.sectionsCompleted]);

  const markChapterVisited = useCallback((sectionIdx: number) => {
    const chapterNum = sectionIdx + 1;
    if (xpAwardedChaptersRef.current.has(chapterNum)) return;
    xpAwardedChaptersRef.current.add(chapterNum);
    giveXP("exploreChapter", { label: `Explored chapter ${String(chapterNum).padStart(2, "0")}` });
    updateLectureProgress((p) => {
      const before = p.sectionsCompleted.length;
      const next = { ...p, sectionsCompleted: uniq([...p.sectionsCompleted, chapterNum]) };
      if (before === 0) return addAchievement(next, { id: "first-jump", title: "First chapter", desc: "You finished a chapter while watching." });
      if (before < 5 && next.sectionsCompleted.length >= 5) return addAchievement(next, { id: "five-chapters", title: "Five chapters", desc: "You explored 5+ chapters." });
      return next;
    });
  }, [updateLectureProgress, giveXP]);

  const applyRestoredLecture = useCallback((lec: SavedLecture, tabOverride?: DashTab) => {
    insightsTranscriptRef.current = null;
    setInsightsError(null);
    setInsightsRetryKey(0);
    setResult(lec.result);
    setStudyMaterials(lec.studyMaterials);
    setChatHistory(lec.chatHistory ?? []);
    setTab(tabOverride && ["summary", "outline", "flashcards", "quiz", "insights", "chat", "find"].includes(tabOverride) ? tabOverride : "summary");
    setActiveSection(0);
    setStage("idle");
    setAppMode("student");
  }, []);

  const tryRestoreLastSession = useCallback(() => {
    const list = loadSavedLectures();
    setSavedLectures(list);
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      if (!raw) return;
      const last = JSON.parse(raw) as { videoId?: string; tab?: DashTab; mode?: AppMode; savedAt?: number };
      if (!last?.videoId || !last.savedAt || Date.now() - last.savedAt > TTL_MS) return;
      const lec = list.find((l) => l.id === last.videoId);
      if (!lec) return;
      if (last.mode === "faculty" || last.mode === "provost") return;
      applyRestoredLecture(lec, last.tab);
    } catch { /* ignore */ }
  }, [applyRestoredLecture]);

  // Load saved lectures + restore last student session (back/forward, refresh)
  useEffect(() => {
    if (isSignedIn) {
      // Load from Supabase when authenticated
      fetch("/api/saved-lectures")
        .then((r) => (r.ok ? r.json() : []))
        .then((lectures) => {
          setSavedLectures(lectures as SavedLecture[]);
        })
        .catch(() => {
          // Fallback to localStorage
          setSavedLectures(loadSavedLectures());
        });
    } else {
      tryRestoreLastSession();
    }
  }, [isSignedIn, tryRestoreLastSession]);

  // One-time migration: push localStorage data to Supabase when user first signs in
  useEffect(() => {
    if (!isSignedIn || hasMergedToCloudRef.current) return;
    hasMergedToCloudRef.current = true;

    const localLectures = loadSavedLectures();
    if (localLectures.length === 0) return;

    // Push each local lecture to Supabase (fire-and-forget)
    localLectures.forEach((lec) => {
      fetch("/api/saved-lectures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id:             lec.id,
          title:          lec.title,
          channelName:    lec.channelName,
          thumbnailUrl:   lec.thumbnailUrl,
          result:         lec.result,
          studyMaterials: lec.studyMaterials,
          chatHistory:    lec.chatHistory ?? [],
        }),
      }).catch(() => { /* non-critical */ });
    });

    // Also push local profile if present
    const localProfile = loadLearnerProfile();
    if (localProfile.quizHistory.length > 0 || localProfile.checkedInLectures.length > 0) {
      fetch("/api/learner-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localProfile),
      }).catch(() => { /* non-critical */ });
    }
  }, [isSignedIn]);

  useEffect(() => {
    // Always locked by default (demo guardrail).
    // We intentionally do NOT persist unlock across sessions.
    setCreatorUnlocked(false);
    try { localStorage.removeItem(CREATOR_UNLOCK_KEY); } catch { /* ignore */ }
  }, []);

  // Load learner profile on mount (or when sign-in state changes)
  useEffect(() => {
    if (isSignedIn) {
      // Try loading from Supabase first
      fetch("/api/learner-profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((cloudProfile) => {
          if (cloudProfile && !cloudProfile.error) {
            setLearnerProfile(cloudProfile as LearnerProfile);
          } else {
            // No cloud profile yet — use local and it will be synced on first write
            const local = loadLearnerProfile();
            setLearnerProfile(local);
          }
        })
        .catch(() => setLearnerProfile(loadLearnerProfile()));
    } else {
      setLearnerProfile(loadLearnerProfile());
    }
  }, [isSignedIn]);

  // Restore last faculty/provost results for demo continuity (7-day TTL)
  useEffect(() => {
    const now = Date.now();
    const fc = loadJson<{ savedAt: number; videoId: string; title: string; channelName: string; report: FacultyAuditReport }>(FACULTY_CACHE_KEY);
    if (fc && now - fc.savedAt <= TTL_MS) {
      setFacultyReport(fc.report);
      setFacultyMeta({ videoId: fc.videoId, title: fc.title, channelName: fc.channelName });
      setFacultyUrl(`https://youtube.com/watch?v=${fc.videoId}`);
    }
    const pc = loadJson<{ savedAt: number; report: CurriculumMapReport; perVideo: any[]; urlsText: string; objectivesText: string }>(PROVOST_CACHE_KEY);
    if (pc && now - pc.savedAt <= TTL_MS) {
      setProvostReport(pc.report);
      setProvostPerVideo(pc.perVideo ?? null);
      setProvostUrlsText(pc.urlsText ?? "");
      setProvostObjectivesText(pc.objectivesText ?? "");
    }
  }, []);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) tryRestoreLastSession();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [tryRestoreLastSession]);

  // Never leave UI in "complete" with no dashboard (blank screen)
  useEffect(() => {
    if (!result && stage === "complete") setStage("idle");
  }, [result, stage]);

  // ── Unified browser history management ──────────────────────────────────────
  // Push one history entry per distinct "view" so back/forward work across all three modes.
  // view key schema: "home" | "student-dashboard" | "faculty-form" | "faculty-loading" | "faculty-report" | "provost-form" | "provost-loading" | "provost-report"

  const pushView = useCallback((view: string, extra?: Record<string, unknown>) => {
    const cur = window.history.state as null | { lecturemate?: boolean; studyai?: boolean; view?: string };
    const inApp = cur?.lecturemate || cur?.studyai;
    if (!inApp || cur.view !== view) {
      window.history.pushState({ lecturemate: true, view, ...extra }, "", window.location.pathname);
    }
  }, []);

  // Student dashboard
  useEffect(() => {
    if (appMode === "student" && result?.videoId) {
      pushView("student-dashboard", { videoId: result.videoId });
      persistLastSession(result.videoId, tab, appMode);
    } else if (appMode === "student") {
      persistLastSession(null, tab, appMode);
    }
  }, [appMode, result?.videoId, tab, pushView]);

  // Faculty views
  useEffect(() => {
    if (appMode !== "faculty") return;
    if (facultyReport) pushView("faculty-report");
    else if (facultyLoading) pushView("faculty-loading");
    else pushView("faculty-form");
  }, [appMode, facultyReport, facultyLoading, pushView]);

  // Provost views
  useEffect(() => {
    if (appMode !== "provost") return;
    if (provostReport) pushView("provost-report");
    else if (provostLoading) pushView("provost-loading");
    else pushView("provost-form");
  }, [appMode, provostReport, provostLoading, pushView]);

  // Handle back-swipe / forward-swipe for all modes
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as null | { lecturemate?: boolean; studyai?: boolean; view?: string; videoId?: string };
      if (!st?.lecturemate && !st?.studyai) {
        // Landed on the "home" entry (before any push) → reset everything
        setResult(null); setStudyMaterials(null); setChatHistory([]);
        setStage("idle"); setError(null); setAppMode("student");
        setFacultyReport(null); setFacultyLoading(false);
        setProvostReport(null); setProvostLoading(false);
        return;
      }
      switch (st.view) {
        case "student-dashboard":
          if (!result) tryRestoreLastSession();
          break;
        case "faculty-form":
          setFacultyReport(null); setFacultyLoading(false); setAppMode("faculty");
          break;
        case "faculty-loading":
          setFacultyReport(null); setAppMode("faculty");
          break;
        case "faculty-report":
          setAppMode("faculty");
          break;
        case "provost-form":
          setProvostReport(null); setProvostLoading(false); setAppMode("provost");
          break;
        case "provost-loading":
          setProvostReport(null); setAppMode("provost");
          break;
        case "provost-report":
          setAppMode("provost");
          break;
        default:
          // Unknown view — safe fallback: go home
          setResult(null); setStudyMaterials(null); setStage("idle"); setAppMode("student");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [result, tryRestoreLastSession]);

  // ── Learner profile helpers ──────────────────────────────────────────────

  const syncProfileToBackend = useCallback(async (profile: LearnerProfile) => {
    try {
      await fetch("/api/learner-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
    } catch { /* non-critical — localStorage is the source of truth */ }
  }, []);

  const handleCheckInDone = useCallback(
    (checkResult: { score: number; level: SkillLevel }) => {
      setCheckInOpen(false);
      setLearnerProfile((prev) => {
        const base = prev ?? loadLearnerProfile();
        const videoId = result?.videoId ?? "";
        const historyEntry = {
          videoId,
          score: checkResult.score,
          level: checkResult.level,
          timestamp: Date.now(),
        };
        const updated: LearnerProfile = {
          ...base,
          overallLevel: adaptLevel(base, checkResult.score),
          chatTone: levelToTone(adaptLevel(base, checkResult.score)),
          quizHistory: [historyEntry, ...base.quizHistory].slice(0, 50),
          checkedInLectures: Array.from(new Set([...base.checkedInLectures, videoId])),
        };
        saveLearnerProfile(updated);
        syncProfileToBackend(updated);
        return updated;
      });
    },
    [result?.videoId, syncProfileToBackend]
  );

  const handleCheckInSkip = useCallback(() => {
    setCheckInOpen(false);
    if (!result?.videoId) return;
    const videoId = result.videoId;
    setLearnerProfile((prev) => {
      const base = prev ?? loadLearnerProfile();
      const updated: LearnerProfile = {
        ...base,
        checkedInLectures: Array.from(new Set([...base.checkedInLectures, videoId])),
      };
      saveLearnerProfile(updated);
      return updated;
    });
  }, [result?.videoId]);

  const seek = useCallback((seconds: number, sectionIdx?: number) => {
    if (sectionIdx !== undefined) setActiveSection(sectionIdx);
    if (ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(Math.floor(seconds), true);
      ytPlayerRef.current.playVideo?.();
    }
  }, []);

  // Auto-progress chapters while watching (YouTube IFrame Player API)
  const updateLectureProgressRef = useRef(updateLectureProgress);
  updateLectureProgressRef.current = updateLectureProgress;
  const markChapterVisitedRef = useRef(markChapterVisited);
  markChapterVisitedRef.current = markChapterVisited;

  useEffect(() => {
    if (appMode !== "student" || !result?.videoId) return;

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const initPlayer = () => {
      if (cancelled) return;

      // Wait for DOM element to exist
      const el = document.getElementById("lecturemate-yt-player");
      if (!el) {
        // Retry after a short delay - the div might not be rendered yet
        setTimeout(() => { if (!cancelled) initPlayer(); }, 300);
        return;
      }

      try {
        ytPlayerRef.current?.destroy?.();
      } catch { /* ignore */ }

      ytPlayerRef.current = new (window as any).YT.Player("lecturemate-yt-player", {
        videoId: result.videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0,
          enablejsapi: 1,
          playsinline: 1,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            ytLastSectionRef.current = -1;
            ytLastPollAtRef.current = Date.now();

            // Start polling for time updates
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(() => {
              if (cancelled) return;
              try {
                const player = ytPlayerRef.current;
                if (!player?.getCurrentTime || !player?.getDuration) return;

                const currentTime = Number(player.getCurrentTime() ?? 0);
                const duration = Number(player.getDuration() ?? 0);
                if (currentTime === 0 && duration === 0) return;

                const sections = resultRef.current?.lecture?.sections;
                if (sections && sections.length > 0) {
                  let idx = 0;
                  for (let i = 0; i < sections.length; i++) {
                    if (currentTime >= sections[i].startTime) idx = i;
                    else break;
                  }

                  const now = Date.now();
                  const lastAt = ytLastPollAtRef.current || now;
                  const elapsedSec = Math.min(45, Math.max(0, (now - lastAt) / 1000));
                  ytLastPollAtRef.current = now;

                  const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
                  const activelyWatching = state === 1 || state === 3;

                  if (activelyWatching && elapsedSec > 0) {
                    sectionWatchAccumRef.current[idx] = (sectionWatchAccumRef.current[idx] ?? 0) + elapsedSec;
                    const thrHere = sectionWatchThresholdSec(sections, idx);
                    if ((sectionWatchAccumRef.current[idx] ?? 0) >= thrHere) {
                      markChapterVisitedRef.current(idx);
                    }
                  }

                  const prevSec = ytLastSectionRef.current;
                  if (prevSec !== idx) {
                    setActiveSection(idx);
                    ytLastSectionRef.current = idx;
                  }
                }

                // Update focusSeconds with actual video currentTime
                if (duration > 0) {
                  const prevProgress = lectureProgressRef.current;
                  if (Math.floor(currentTime) > prevProgress.focusSeconds + 5) {
                    updateLectureProgressRef.current((prev) => ({
                      ...prev,
                      focusSeconds: Math.floor(currentTime),
                    }));
                  }
                }
              } catch { /* player not ready yet */ }
            }, 2000);
          },
        },
      });
    };

    // Ensure YouTube IFrame API is loaded
    if ((window as any).YT?.Player) {
      // Small delay to ensure DOM is ready after React render
      setTimeout(initPlayer, 100);
    } else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-lecturemate-yt]");
      if (!existing) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.async = true;
        s.dataset.lecturemateYt = "1";
        document.head.appendChild(s);
      }

      const prevCallback = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        if (!cancelled) setTimeout(initPlayer, 100);
      };

      // Also poll in case the callback was already fired
      const checkReady = setInterval(() => {
        if ((window as any).YT?.Player) {
          clearInterval(checkReady);
          if (!cancelled && !ytPlayerRef.current) setTimeout(initPlayer, 100);
        }
      }, 500);

      return () => {
        cancelled = true;
        clearInterval(checkReady);
        if (pollInterval) clearInterval(pollInterval);
        try { ytPlayerRef.current?.destroy?.(); } catch { /* ignore */ }
        ytPlayerRef.current = null;
        ytLastSectionRef.current = -1;
      };
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      try { ytPlayerRef.current?.destroy?.(); } catch { /* ignore */ }
      ytPlayerRef.current = null;
      ytLastSectionRef.current = -1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, result?.videoId]);

  const startProgress = () => {
    setProgress(0);
    if (progressRef.current) clearInterval(progressRef.current);
    // Asymptotic progress — slows down naturally, never hits 95
    progressRef.current = setInterval(() => {
      setProgress((p) => {
        const delta = (95 - p) * 0.025;
        return Math.min(p + delta, 94.9);
      });
    }, 200);
  };

  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
  };

  // Advance step labels during processing
  useEffect(() => {
    if (stage === "extracting") setStepIdx(0);
    if (stage === "structuring") setStepIdx(1);
    if (stage === "generating") setStepIdx(2);
  }, [stage]);

  const submit = async (overrideUrl?: string) => {
    if (appMode !== "student") return;
    const target = (overrideUrl ?? url).trim();
    if (!target) return;

    // Rate limit check: guests use server-side IP, signed-in users use localStorage
    if (!isSignedIn) {
      // Guest: server-side IP-based rate limiting
      const { canGuestUseUrl, incrementGuestUrlCount } = await import("@/app/lib/guestSession");
      const result = await canGuestUseUrl();
      if (!result.allowed) {
        setError("You've reached your daily limit of 1 URL. Please try again tomorrow.");
        return;
      }
      if (result.warning) {
        setUrlWarning("⚠️ Only 0 URLs remaining today!");
      } else {
        setUrlWarning(null);
      }
      // Increment after successful submission (will be called after processing starts)
    } else {
      // Signed-in: localStorage-based rate limiting (5 per day)
      const result = canUseUrl(target, isSignedIn);
      if (!result.allowed) {
        setError("You've reached your daily limit of 5 URLs. Please try again tomorrow.");
        return;
      }
      if (result.warning) {
        setUrlWarning(`⚠️ Only ${result.remaining} URL${result.remaining !== 1 ? 's' : ''} remaining today!`);
      } else {
        setUrlWarning(null);
      }
    }

    setLoadingQuote(pickQuote("student"));
    setError(null);
    setInsightsRetryKey(0);
    setInsightsError(null);
    setResult(null);
    setStudyMaterials(null);
    setStepIdx(0);
    setStage("extracting");
    setTab("summary");
    setActiveSection(0);
    startProgress();

    const stageTimer1 = setTimeout(() => setStage("structuring"), 3000);
    const stageTimer2 = setTimeout(() => setStage("generating"), 7000);

    try {
      const res = await fetch("/api/process-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });

      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      finishProgress();

      const data = await res.json();
      if (!res.ok) { setStage("error"); setError(data.error ?? "Processing failed."); return; }

      const rawTranscript = data.transcript as TranscriptEntry[] | undefined;
      insightsTranscriptRef.current = Array.isArray(rawTranscript) && rawTranscript.length > 0 ? rawTranscript : null;
      const { transcript: _omitTr, ...resultPayload } = data as typeof data & { transcript?: TranscriptEntry[] };
      setResult(resultPayload as ProcessResult);
      setStudyMaterials(data.studyMaterials);
      setChatHistory([]);
      setStage("complete");
      celebrate();
      
      // Increment guest URL count if guest user
      if (!isSignedIn) {
        const { incrementGuestUrlCount } = await import("@/app/lib/guestSession");
        await incrementGuestUrlCount();
      }
      
      // Open check-in modal if not already done for this video
      setLearnerProfile((prev) => {
        const profile = prev ?? loadLearnerProfile();
        if (!profile.checkedInLectures.includes(data.videoId)) {
          setCheckInOpen(true);
        }
        return profile;
      });
      // Persist to localStorage (always) + Supabase (when signed in)
      const entry: SavedLecture = {
        id: data.videoId,
        title: data.lecture.title,
        channelName: data.metadata.channelName,
        thumbnailUrl: data.metadata.thumbnailUrl,
        savedAt: Date.now(),
        result: resultPayload as ProcessResult,
        studyMaterials: data.studyMaterials,
        chatHistory: [],
      };
      saveLecture(entry);
      if (isSignedIn) {
        fetch("/api/saved-lectures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id:             entry.id,
            title:          entry.title,
            channelName:    entry.channelName,
            thumbnailUrl:   entry.thumbnailUrl,
            result:         entry.result,
            studyMaterials: entry.studyMaterials,
            chatHistory:    [],
          }),
        })
          .then((r) => r.ok ? fetch("/api/saved-lectures").then((r2) => r2.ok ? r2.json() : []) : loadSavedLectures())
          .then((lectures) => setSavedLectures(lectures as SavedLecture[]))
          .catch(() => setSavedLectures(loadSavedLectures()));
      } else {
        setSavedLectures(loadSavedLectures());
      }
      setTimeout(() => setStage("idle"), 300);
    } catch {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      finishProgress();
      setStage("error");
      setError("Network error. Please check your connection and try again.");
    }
  };

  const reset = () => {
    insightsTranscriptRef.current = null;
    setInsightsLoading(false);
    setInsightsError(null);
    setInsightsRetryKey(0);
    setResult(null); setStudyMaterials(null);
    setStage("idle"); setError(null); setUrl("");
    setProgress(0); setChatHistory([]);
    setFacultyUrl(""); setFacultyError(null); setFacultyReport(null); setFacultyMeta(null); setFacultyLoading(false);
    setProvostUrlsText(""); setProvostObjectivesText(""); setProvostError(null); setProvostReport(null); setProvostPerVideo(null); setProvostLoading(false);
    setAppMode("student");
    persistLastSession(null, "summary", "student");
  };

  const unlockCreatorTools = () => {
    const code = unlockCode.trim().toLowerCase();
    // Hackathon-grade gating: keeps these modes out of the student flow by default.
    // Not security; just prevents accidental student access in demos.
    if (code !== "lecturemate" && code !== "studyai") {
      setUnlockError("Invalid code.");
      return;
    }
    setUnlockError(null);
    setCreatorUnlocked(true);
    setUnlockOpen(false);
    setUnlockCode("");
  };

  const switchMode = (m: AppMode) => {
    if ((m === "faculty" || m === "provost") && !creatorUnlocked) {
      setUnlockOpen(true);
      setUnlockError(null);
      setUnlockCode("");
      return;
    }
    setAppMode(m);
    setSidebarOpen(false);
    setError(null);
    if (m === "student") {
      setFacultyReport(null); setFacultyError(null); setFacultyLoading(false);
      setProvostReport(null); setProvostError(null); setProvostLoading(false);
    } else if (m === "faculty") {
      setResult(null); setStudyMaterials(null); setChatHistory([]);
      setProvostReport(null); setProvostError(null); setProvostPerVideo(null); setProvostLoading(false);
      setStage("idle");
    } else {
      setResult(null); setStudyMaterials(null); setChatHistory([]);
      setFacultyReport(null); setFacultyError(null); setFacultyLoading(false);
      setStage("idle");
    }
  };

  const loadFromHistory = (saved: SavedLecture) => {
    applyRestoredLecture(saved);
  };

  const submitFaculty = async () => {
    const target = facultyUrl.trim();
    if (!target) return;
    setFacultyError(null);
    setFacultyReport(null);
    setFacultyMeta(null);
    setFacultyLoading(true);
    setLoadingQuote(pickQuote("faculty"));
    try {
      const res = await fetch("/api/faculty-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFacultyError(data.error ?? "Audit failed.");
        return;
      }
      setFacultyReport(data.report as FacultyAuditReport);
      setFacultyMeta({
        videoId: data.videoId,
        title: data.metadata?.title ?? "",
        channelName: data.metadata?.channelName ?? "",
      });
      saveJson(FACULTY_CACHE_KEY, {
        savedAt: Date.now(),
        videoId: data.videoId,
        title: data.metadata?.title ?? "",
        channelName: data.metadata?.channelName ?? "",
        report: data.report,
      });
    } catch {
      setFacultyError("Network error. Please try again.");
    } finally {
      setFacultyLoading(false);
    }
  };

  const submitProvost = async () => {
    const urls = provostUrlsText.split(/\n/).map((s) => s.trim()).filter(Boolean);
    const objectives = provostObjectivesText.split(/\n/).map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0 || objectives.length === 0) {
      setProvostError("Add at least one lecture URL and one learning objective (one per line).");
      return;
    }
    setProvostError(null);
    setProvostReport(null);
    setProvostPerVideo(null);
    setProvostLoading(true);
    setLoadingQuote(pickQuote("provost"));
    try {
      const res = await fetch("/api/curriculum-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, objectives }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProvostError(data.error ?? "Curriculum mapping failed.");
        setProvostPerVideo(data.perVideo ?? null);
        return;
      }
      setProvostReport(data.report as CurriculumMapReport);
      setProvostPerVideo(data.perVideo ?? null);
      saveJson(PROVOST_CACHE_KEY, {
        savedAt: Date.now(),
        report: data.report,
        perVideo: data.perVideo ?? null,
        urlsText: provostUrlsText,
        objectivesText: provostObjectivesText,
      });
    } catch {
      setProvostError("Network error. Please try again.");
    } finally {
      setProvostLoading(false);
    }
  };

  const isProcessing = stage === "extracting" || stage === "structuring" || stage === "generating";

  // Memoize background to prevent remounting on every render
  const background = useMemo(() => {
    const shouldShow = appMode === "student" && (gateState !== "app" || (!result && stage === "idle") || isProcessing);
    return shouldShow ? <AnimatedBackground density={70} interactive theme={theme} zIndex={0} /> : null;
  }, [appMode, gateState, result, stage, isProcessing, theme]);

  return (
    <div className={theme} style={{ position: "relative", isolation: "isolate", minHeight: "100vh" }}>
      {/* Constellation background — only on sign-in, home page, and during processing */}
      {background}

      {/*
        ── Gate overlay — covers the entire screen until user picks a path.
        Exists in "loading" phase (session resolving, opaque blank cover) and
        "gate" phase (form visible). Only UNMOUNTS when gateState === "app".
        Using a SINGLE AnimatePresence node so there is NEVER a gap between
        the loading cover and the gate — the hero can never flash through.
      */}
      <AnimatePresence>
        {gateState !== "app" && (
          <SignInGate
            phase={gateState}
            onContinue={() => setGateState("app")}
          />
        )}
      </AnimatePresence>

      <div className="flex min-h-screen" style={{ color: "var(--foreground)" }}>

        {/* ── Left Sidebar (ChatGPT-style) ── */}
        {/* Overlay backdrop on mobile */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 lg:hidden" style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className="fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r transition-all duration-300 overflow-hidden"
          style={{
            width: sidebarOpen ? "260px" : "0px",
            background: "var(--surface)",
            borderColor: "var(--border)",
            minWidth: 0,
          }}>
          <div style={{ width: "260px", minWidth: "260px" }} className="flex flex-col h-full">
            {/* Sidebar header */}
            <div className="flex items-center gap-2.5 px-4 h-14 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
              <LecturemateLogo size={26} />
              <span className="text-[15px] font-semibold tracking-tight">Lecturemate AI</span>
              <button onClick={() => setSidebarOpen(false)} className="ml-auto opacity-50 hover:opacity-100 transition">
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            {/* Mode + Creator tools + Reset */}
            <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider px-1" style={{ color: "var(--muted-foreground)" }}>Mode</div>
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => switchMode("student")}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition hover:opacity-90"
                  style={{ background: appMode === "student" ? "var(--surface-elevated)" : "transparent", color: "var(--foreground)" }}>
                  <BookOpen className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} /> Student
                </button>
                <div className="mt-2">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Creator tools</span>
                    {!creatorUnlocked && (
                      <button type="button" onClick={() => { setUnlockOpen(true); setUnlockError(null); setUnlockCode(""); }}
                        className="text-[10px] hover:opacity-70 transition" style={{ color: "var(--muted-foreground)" }}>
                        Unlock
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => switchMode("faculty")}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition hover:opacity-90"
                    style={{
                      background: appMode === "faculty" ? "var(--surface-elevated)" : "transparent",
                      color: "var(--foreground)",
                      opacity: creatorUnlocked ? 1 : 0.5,
                    }}>
                    <UserRound className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} /> Faculty audit
                  </button>
                  <button type="button" onClick={() => switchMode("provost")}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition hover:opacity-90"
                    style={{
                      background: appMode === "provost" ? "var(--surface-elevated)" : "transparent",
                      color: "var(--foreground)",
                      opacity: creatorUnlocked ? 1 : 0.5,
                    }}>
                    <LineChart className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }} /> Provost map
                  </button>
                  <p className="text-[10px] mt-1 px-1 leading-relaxed" style={{ color: "var(--muted-foreground)", opacity: 0.8 }}>
                    Private on this device. Not for student use.
                  </p>
                </div>
              </div>
              <button onClick={() => { reset(); setSidebarOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium hover:opacity-80 transition"
                style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>
                <Plus className="h-3.5 w-3.5" /> Reset app
              </button>
            </div>
            {/* Recent lectures list */}
            <div className="flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
              {savedLectures.length === 0 ? (
                <p className="text-[11px] px-2 py-3" style={{ color: "var(--muted-foreground)" }}>No lectures saved yet.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between px-2 pt-3 pb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Recent</span>
                    <button onClick={() => {
                      setSavedLectures([]);
                      localStorage.removeItem(STORAGE_KEY);
                      if (isSignedIn) {
                        // Cloud: bulk delete by clearing each (no bulk API needed — just clear local list)
                        fetch("/api/saved-lectures").then((r) => r.ok ? r.json() : [])
                          .then((lectures: SavedLecture[]) => {
                            lectures.forEach((l) => fetch(`/api/saved-lectures?id=${l.id}`, { method: "DELETE" }).catch(() => {}));
                          }).catch(() => {});
                      }
                    }}
                      className="text-[10px] hover:opacity-70 transition" style={{ color: "var(--muted-foreground)" }}>Clear</button>
                  </div>
                  {savedLectures.map((s) => (
                    <div key={s.id}
                      className="group relative flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition cursor-pointer"
                      style={{ background: result?.videoId === s.id ? "var(--surface-elevated)" : "transparent" }}
                      onClick={() => { loadFromHistory(s); setSidebarOpen(false); }}>
                      <div className="h-8 w-12 rounded bg-border shrink-0 overflow-hidden">
                        {/* prefer stored thumbnailUrl; fallback to i.yt */}
                        <img
                          src={s.thumbnailUrl || `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] leading-tight line-clamp-2" style={{ color: "color-mix(in oklab, var(--foreground) 90%, transparent)" }}>{s.title}</p>
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: "color-mix(in oklab, var(--muted-foreground) 75%, transparent)" }}>
                          {s.channelName}
                        </p>
                      </div>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedLecture(s.id);
                        if (isSignedIn) {
                          fetch(`/api/saved-lectures?id=${encodeURIComponent(s.id)}`, { method: "DELETE" })
                            .then(() => fetch("/api/saved-lectures").then((r) => r.ok ? r.json() : []))
                            .then((lectures) => setSavedLectures(lectures as SavedLecture[]))
                            .catch(() => setSavedLectures(loadSavedLectures()));
                        } else {
                          setSavedLectures(loadSavedLectures());
                        }
                      }}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 transition"
                        style={{ color: "var(--muted-foreground)", background: "transparent" }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
            {/* Sidebar footer */}
            <div className="shrink-0 px-3 py-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>

              {lectureProgress.achievements.length > 0 && (
                <div>
                  <button
                    onClick={() => { setSidebarOpen(false); if (result) setTab("summary"); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs hover:opacity-80 transition"
                    style={{ color: "var(--muted-foreground)", background: "var(--surface-elevated)" }}
                  >
                    <Trophy className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} />
                    {lectureProgress.achievements.length} achievement{lectureProgress.achievements.length === 1 ? "" : "s"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main content area (shifts right when sidebar is open) ── */}
        <div className="flex flex-col min-h-screen w-full transition-all duration-300"
          style={{ marginLeft: sidebarOpen ? "260px" : "0px" }}>

          {/* ── Header ── */}
          <header className="sticky top-0 z-50 backdrop-blur-xl border-b shrink-0"
            style={{ background: "color-mix(in oklab, var(--background) 80%, transparent)", borderColor: "var(--border)" }}>
            <div className="flex h-14 items-center justify-between px-4 md:px-6">
              {/* Left: sidebar toggle + logo */}
              <div className="flex items-center gap-3">
                <button onClick={() => setSidebarOpen((v) => !v)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:opacity-70 transition"
                  style={{ color: "var(--muted-foreground)" }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect y="2" width="16" height="1.5" rx="0.75" />
                    <rect y="7.25" width="16" height="1.5" rx="0.75" />
                    <rect y="12.5" width="16" height="1.5" rx="0.75" />
                  </svg>
                </button>
                <button onClick={reset} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <LecturemateLogo size={26} />
                  <span className="text-[15px] font-semibold tracking-tight">Lecturemate AI</span>
                  <span className="hidden sm:inline text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>v1.0</span>
                </button>
              </div>
              {/* Right: new lecture + theme + user */}
              <div className="flex items-center gap-1">
                {result && (
                  <button onClick={reset}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition hover:opacity-80"
                    style={{ color: "var(--muted-foreground)" }}>
                    <Plus className="h-3.5 w-3.5" /> New lecture
                  </button>
                )}
                {/* Auth: avatar when signed in, sign-in button when guest */}
                <HeaderUserArea
                  session={session}
                  onSignOut={() => signOut()}
                  onShowGate={() => {
                    try {
                      localStorage.removeItem("lecturemate_guest_confirmed");
                      localStorage.removeItem("studyai_guest_confirmed");
                    } catch { /* ignore */ }
                    setGateState("gate");
                  }}
                />
              </div>
            </div>
          </header>

        <AnimatePresence mode="wait">

          {/* ══ HERO (Student) ══ */}
          {appMode === "student" && !result && stage === "idle" && (
            <motion.main key="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1">
              <div className="relative overflow-hidden">
                <div className="absolute inset-0 -z-10">
                </div>

                {/* Hero section — Lovable-style split hero */}
                <section className="mx-auto max-w-[1280px] px-4 sm:px-6 md:px-10 pt-10 sm:pt-16 pb-16 sm:pb-20">
                  <div className="grid grid-cols-12 gap-6 md:gap-10 items-end">
                    <div className="col-span-12 text-center">
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.18em] mb-6 sm:mb-7"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted-foreground)" }}>
                      <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} />
                      A study companion, not a search engine
                    </motion.div>

                    <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 }}
                      className="font-semibold tracking-[-0.03em] leading-[0.98] mb-6 sm:mb-7"
                      style={{ fontSize: "clamp(2.4rem, 6.5vw, 5.25rem)" }}>
                      Read every lecture<br />
                      <span className="font-serif italic font-normal" style={{ color: "var(--muted-foreground)" }}>in the time it takes to</span>
                      <br />make coffee.
                    </motion.h1>

                    <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
                      className="text-base sm:text-lg leading-relaxed mb-8 sm:mb-10 max-w-2xl mx-auto px-2"
                      style={{ color: "var(--muted-foreground)" }}>
                      Paste a YouTube URL. Four AI agents extract, structure, and summarize the lecture into a calm, focused study workspace with chat, flashcards, and semantic search built in.
                    </motion.p>

                    <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.35 }}
                      onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-10 max-w-2xl mx-auto">

                      <div className="surface flex items-center gap-2 rounded-2xl p-2 shadow-card relative transition"
                        style={{ borderColor: "var(--border)" }}>
                        <div className="hidden sm:flex items-center gap-2 pl-3 pr-2 border-r shrink-0" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                          <span className="font-mono text-xs uppercase tracking-wider">URL</span>
                        </div>
                        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                          placeholder="youtube.com/watch?v=..."
                          className="flex-1 bg-transparent border-0 outline-none text-base py-2.5 px-3 min-w-0"
                          style={{ color: "var(--foreground)" }} autoFocus />
                        <button type="submit" disabled={!url.trim()}
                          className="flex items-center gap-1.5 h-11 px-5 rounded-xl text-sm font-medium transition-all disabled:opacity-40 shrink-0 hover:opacity-90"
                          style={{ background: "var(--foreground)", color: "var(--background)" }}>
                          Build my study kit <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
                        <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>Try</span>
                        {EXAMPLE_URLS.map((ex) => (
                          <button key={ex.url} type="button" onClick={() => { setUrl(ex.url); submit(ex.url); }}
                            className="text-[11px] sm:text-xs px-3 py-1.5 rounded-full border transition hover:opacity-80"
                            style={{ borderColor: "var(--border)", color: "var(--muted-foreground)", background: "var(--surface)" }}>
                            {ex.label}
                          </button>
                        ))}
                      </div>
                    </motion.form>

                    {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm mt-4 text-center" style={{ color: "var(--destructive)" }}>{error}</motion.p>}

                    <div className="mt-6 flex items-center justify-center gap-4 text-xs" style={{ color: "color-mix(in oklab, var(--muted-foreground) 85%, transparent)" }}>
                      <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} /> ~30s avg build time</div>
                      <div style={{ opacity: 0.3 }}>·</div>
                      <div className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} /> Works on captioned videos</div>
                    </div>

                    </div>

                  </div>
                </section>

                {/* Built for moments — student personas */}
                <section className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12 pb-16 sm:pb-24">
                  <div className="text-center mb-8 sm:mb-12">
                    <div className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: "var(--muted-foreground)" }}>§01 - Built for students</div>
                    <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl leading-[1.05] tracking-tight">
                      For the moments <em className="italic" style={{ color: "var(--primary)" }}>that matter</em>.
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { icon: Coffee,         t: "Cramming for finals",     d: "Turn 2-hour lectures into bite-sized summaries the night before." },
                      { icon: Target,         t: "Catching up after class", d: "Get the structure, key concepts, and a study deck instantly." },
                      { icon: GraduationCap,  t: "Self-learning",            d: "Build a study workspace from any expert lecture on YouTube." },
                      { icon: BookOpen,       t: "Exam preparation",         d: "Test yourself with AI-generated quizzes and flashcards." },
                    ].map((p, i) => (
                      <motion.div key={p.t} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} transition={{ duration: 0.45, delay: i * 0.06 }}
                        className="surface rounded-2xl p-5 sm:p-6 hover:shadow-card transition group">
                        <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                          style={{ background: "color-mix(in oklab, var(--primary) 15%, transparent)" }}>
                          <p.icon className="h-5 w-5" style={{ color: "var(--primary)" }} strokeWidth={1.75} />
                        </div>
                        <h3 className="font-serif text-lg sm:text-xl mb-1.5 leading-tight">{p.t}</h3>
                        <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{p.d}</p>
                      </motion.div>
                    ))}
                  </div>
                </section>

                {/* Pipeline section */}
              </div>
            </motion.main>
          )}

          {/* ══ PROCESSING (Student) ══ */}
          {appMode === "student" && (isProcessing || stage === "error") && !result && (
            <motion.main key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center px-4 py-16 relative">
              {stage !== "error" && (
                <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                  <div
                    className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full blur-[140px] animate-pulse-soft"
                    style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}
                  />
                </div>
              )}

              {stage === "error" ? (
                <div className="max-w-sm text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: "color-mix(in oklab, var(--destructive) 15%, transparent)" }}>
                    <span className="text-2xl">⚠️</span>
                  </div>
                  <h2 className="font-serif text-3xl mb-3">Something went wrong.</h2>
                  <p className="text-sm mb-8 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{error}</p>
                  <button onClick={reset} className="px-6 py-3 rounded-xl text-sm font-medium"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    Try again
                  </button>
                </div>
              ) : (
                <div className="w-full max-w-md">
                  {/* Animated neural-net graphic */}
                  <div className="flex justify-center mb-10">
                    <div className="relative w-40 h-40">
                      {/* Slow outer orbit ring */}
                      <motion.div className="absolute inset-0" animate={{ rotate: 360 }}
                        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
                        <svg viewBox="0 0 160 160" className="w-full h-full">
                          <circle cx="80" cy="80" r="74" fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 10" />
                        </svg>
                      </motion.div>
                      {/* Fast inner orbit ring */}
                      <motion.div className="absolute inset-0" animate={{ rotate: -360 }}
                        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}>
                        <svg viewBox="0 0 160 160" className="w-full h-full">
                          <circle cx="80" cy="80" r="50" fill="none" stroke="color-mix(in oklab, var(--primary) 35%, transparent)" strokeWidth="1.5" strokeDasharray="3 14" />
                          {/* Orbiting dot */}
                          <circle cx="80" cy="30" r="5" fill="var(--primary)" />
                        </svg>
                      </motion.div>
                      {/* Progress arc */}
                      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 160 160">
                        <motion.circle cx="80" cy="80" r="74" fill="none" stroke="var(--primary)" strokeWidth="2"
                          strokeLinecap="round" strokeDasharray={2 * Math.PI * 74}
                          initial={{ strokeDashoffset: 2 * Math.PI * 74 }}
                          animate={{ strokeDashoffset: 2 * Math.PI * 74 * (1 - progress / 100) }}
                          transition={{ duration: 0.4, ease: "easeOut" }} />
                      </svg>
                      {/* Centre: pulsing brain */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                        <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
                          <Brain className="h-9 w-9" style={{ color: "var(--primary)" }} />
                        </motion.div>
                        <span className="font-mono text-[11px] font-medium">{Math.floor(progress)}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center mb-8">
                    <h2 className="font-serif text-3xl mb-2">Analyzing your lecture</h2>
                    <p className="text-sm mt-3 italic" style={{ color: "var(--muted-foreground)" }}>&ldquo;{loadingQuote}&rdquo;</p>
                  </div>

                  {/* Steps */}
                  <div className="space-y-3">
                    {PIPELINE_STEPS.map((step, i) => {
                      const done = i < stepIdx;
                      const active = i === stepIdx;
                      return (
                        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                          style={{
                            background: active ? "color-mix(in oklab, var(--primary) 6%, transparent)" : done ? "color-mix(in oklab, var(--success) 5%, transparent)" : "transparent",
                            border: `1px solid ${active ? "color-mix(in oklab, var(--primary) 25%, transparent)" : done ? "color-mix(in oklab, var(--success) 20%, transparent)" : "var(--border)"}`,
                            opacity: !active && !done ? 0.4 : 1,
                          }}>
                          <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                            {done
                              ? <CheckCircle2 className="w-5 h-5" style={{ color: "var(--success)" }} />
                              : active
                              ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}>
                                  <Loader2 className="w-4 h-4" style={{ color: "var(--primary)" }} />
                                </motion.div>
                              : <span className="text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{i + 1}</span>
                            }
                          </div>
                          <span className="text-sm" style={{ color: active ? "var(--foreground)" : done ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            {step.label}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.main>
          )}

          {/* ══ DASHBOARD (Student) ══ */}
          {appMode === "student" && result && studyMaterials && (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
              {/* Title bar */}
              <div className="border-b shrink-0" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 40%, transparent)" }}>
                <div className="w-full px-4 md:px-6 lg:px-8 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: "var(--muted-foreground)" }}>
                        <span>{result.metadata.channelName}</span>
                        <span className="opacity-30">/</span>
                        <span>{result.lecture.sections.length} chapters</span>
                        <span className="opacity-30">/</span>
                        <span>{studyMaterials.flashcards.length} flashcards</span>
                        <span className="opacity-30">/</span>
                        <span>{studyMaterials.concepts.length} concepts</span>
                      </div>
                      <h1 className="font-serif tracking-tight leading-[1.08] max-w-3xl" style={{ fontSize: "clamp(1.4rem, 3.5vw, 2.5rem)" }}>
                        {result.lecture.title}
                      </h1>
                    </div>
                  </div>
                </div>
              </div>

              <main className="flex-1 w-full overflow-x-auto">
                <div className="px-4 md:px-6 lg:px-8 py-6" style={{ minWidth: "1100px" }}>
                <div className="grid gap-5" style={{ gridTemplateColumns: "200px 1fr 240px" }}>

                  {/* Left: Chapter rail */}
                  <aside>
                    <ProgressPanel
                      lecture={result.lecture}
                      materials={studyMaterials}
                      progress={lectureProgress}
                    />
                    <ChapterRail lecture={result.lecture} activeSection={activeSection} onSeek={seek} />
                  </aside>

                  {/* Center */}
                  <section className="space-y-5 min-w-0">
                    <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }}
                      className="aspect-video rounded-xl overflow-hidden border shadow-elegant"
                      style={{ borderColor: "var(--border)", background: "#000" }}>
                      <div ref={iframeRef} id="lecturemate-yt-player" className="w-full h-full" />
                    </motion.div>

                    {/* Tab bar (full-width) */}
                    <div className="border-b" style={{ borderColor: "var(--border)" }}>
                      <div className="hidden md:grid grid-cols-6">
                        {([
                          { id: "summary",    label: "Summary",    icon: FileText },
                          { id: "flashcards", label: "Flashcards", icon: Layers },
                          { id: "quiz",       label: "Quiz",       icon: Trophy },
                          { id: "insights",   label: "Insights",   icon: Brain },
                          { id: "chat",       label: "Chat",       icon: MessageCircle },
                          { id: "find",       label: "Find",       icon: Search },
                        ] as { id: DashTab; label: string; icon: typeof FileText }[]).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className="relative py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                            style={{ color: tab === t.id ? "var(--foreground)" : "var(--muted-foreground)" }}
                          >
                            <t.icon className="h-3.5 w-3.5" strokeWidth={2} />
                            {t.label}
                            {tab === t.id && (
                              <motion.div
                                layoutId="tab-underline"
                                className="absolute -bottom-px left-6 right-6 h-px"
                                style={{ background: "var(--foreground)" }}
                                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                              />
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Mobile: keep scroll */}
                      <div className="md:hidden flex gap-0 overflow-x-auto scrollbar-hide">
                        {([
                          { id: "summary",    label: "Summary",    icon: FileText },
                          { id: "flashcards", label: "Flashcards", icon: Layers },
                          { id: "quiz",       label: "Quiz",       icon: Trophy },
                          { id: "insights",   label: "Insights",   icon: Brain },
                          { id: "chat",       label: "Chat",       icon: MessageCircle },
                          { id: "find",       label: "Find",       icon: Search },
                        ] as { id: DashTab; label: string; icon: typeof FileText }[]).map((t) => (
                          <button key={t.id} onClick={() => setTab(t.id)}
                            className="relative px-4 py-3 text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-colors"
                            style={{ color: tab === t.id ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            <t.icon className="h-3.5 w-3.5" strokeWidth={2} />
                            {t.label}
                            {tab === t.id && (
                              <motion.div layoutId="tab-underline-mobile" className="absolute -bottom-px left-0 right-0 h-px"
                                style={{ background: "var(--foreground)" }}
                                transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-h-[400px]">
                      <AnimatePresence mode="wait">
                        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                          {tab === "summary" && <SummaryTab materials={studyMaterials} skillLevel={learnerProfile?.overallLevel} />}
                          {tab === "flashcards" && (
                            <FlashcardsTab
                              materials={studyMaterials}
                              onSeek={seek}
                              reviewed={lectureProgress.cardsReviewed}
                              onReviewed={(idx) => {
                                giveXP("reviewFlashcard", { label: "Flashcard reviewed" });
                                updateLectureProgress((p) => {
                                  const next = { ...p, cardsReviewed: uniq([...p.cardsReviewed, idx]) };
                                  if (next.cardsReviewed.length >= studyMaterials.flashcards.length && studyMaterials.flashcards.length > 0) {
                                    celebrate();
                                    return addAchievement(next, { id: "all-cards", title: "Card master", desc: "Reviewed every flashcard." });
                                  }
                                  if (next.cardsReviewed.length >= 3) {
                                    return addAchievement(next, { id: "three-cards", title: "Recall mode", desc: "Reviewed 3 flashcards." });
                                  }
                                  return next;
                                });
                              }}
                            />
                          )}
                          {tab === "quiz" && (
                            <QuizTab
                              materials={studyMaterials}
                              skillLevel={learnerProfile?.overallLevel}
                              onCompleted={(pct, weakTopics) => {
                                giveXP("completeQuiz", { label: "Quiz completed" });
                                if (pct >= 80) giveXP("score80Plus", { quizScore: pct, label: "Scored 80%+" });
                                updateLectureProgress((p) => {
                                  const next = { ...p, quizScore: pct, weakTopics };
                                  if (pct === 100) {
                                    celebrate();
                                    return addAchievement(next, { id: "perfect-quiz", title: "Perfect score", desc: "100% on the quiz." });
                                  }
                                  if (pct >= 70) return addAchievement(next, { id: "passed-quiz", title: "Concept solid", desc: "Passed the quiz." });
                                  return next;
                                });
                                // Continuous adaptation: update profile with new quiz score
                                setLearnerProfile((prev) => {
                                  if (!prev) return prev;
                                  const historyEntry = {
                                    videoId: result.videoId,
                                    score: pct,
                                    level: prev.overallLevel,
                                    timestamp: Date.now(),
                                  };
                                  const updated: LearnerProfile = {
                                    ...prev,
                                    quizHistory: [historyEntry, ...prev.quizHistory].slice(0, 50),
                                    overallLevel: adaptLevel(prev, pct),
                                    chatTone: levelToTone(adaptLevel(prev, pct)),
                                  };
                                  saveLearnerProfile(updated);
                                  syncProfileToBackend({ ...updated, newQuizScore: pct } as LearnerProfile & { newQuizScore: number });
                                  return updated;
                                });
                              }}
                            />
                          )}
                          {tab === "insights" && (
                            <InsightsTab
                              insights={result.insights}
                              insightsLoading={insightsLoading}
                              insightsError={insightsError}
                              onRetryInsights={() => {
                                setInsightsError(null);
                                setInsightsRetryKey((k) => k + 1);
                              }}
                              concepts={studyMaterials.concepts}
                              onSeek={seek}
                              weakTopics={lectureProgress.weakTopics}
                            />
                          )}
                          {tab === "chat" && (
                            <ChatTab
                              result={result}
                              materials={studyMaterials}
                              initialHistory={chatHistory}
                              skillLevel={learnerProfile?.overallLevel}
                              onHistoryChange={(h) => {
                                setChatHistory(h);
                                updateChatHistory(result.videoId, h);
                                // Also sync to Supabase when signed in
                                if (isSignedIn) {
                                  fetch("/api/saved-lectures", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ id: result.videoId, chatHistory: h, chatHistoryOnly: true }),
                                  }).catch(() => { /* non-critical */ });
                                }
                              }}
                              onUsed={() => { giveXP("useChat", { label: "Asked Lecturemate" }); updateLectureProgress({ chatUsed: true }); }}
                            />
                          )}
                          {tab === "find" && (
                            <FindTab
                              lecture={result.lecture}
                              onSeek={seek}
                              onUsed={() => { giveXP("useSearch", { label: "Used semantic search" }); updateLectureProgress({ searchUsed: true }); }}
                            />
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </section>

                  {/* Right */}
                  <aside className="space-y-5 min-w-0">
                    {/* Scholar Level */}
                    {(() => {
                      const { level, currentXP, nextLevelXP, progress } = getLevelInfo(xpState.totalXP);
                      return (
                        <div className="rounded-xl p-4 border" style={{ background: "var(--surface-elevated)", borderColor: "var(--border)" }}>
                          <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-3 flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
                            ⭐ Scholar Level
                          </div>
                          <div className="flex items-center gap-3 mb-3">
                            <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 font-bold text-lg"
                              style={{ background: "linear-gradient(135deg,#ff8c14,#ff4500)", color: "#fff", boxShadow: "0 2px 12px rgba(255,100,20,0.45)", fontFamily: "var(--font-mono)" }}>
                              {level}
                            </div>
                            <div>
                              <div className="font-semibold text-sm">Lv. {level}</div>
                              <div className="text-[10px] font-mono mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                                {currentXP} / {nextLevelXP} XP to Lv. {level + 1}
                              </div>
                            </div>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: "var(--border)" }}>
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg,#ff8c14,#ff4500)" }} />
                          </div>
                          <div className="text-[10px] font-mono text-right" style={{ color: "var(--muted-foreground)" }}>
                            Total XP: {xpState.totalXP}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Daily Quests */}
                    <div className="rounded-xl p-4 border" style={{ background: "var(--surface-elevated)", borderColor: "var(--border)" }}>
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-3 flex items-center justify-between" style={{ color: "var(--muted-foreground)" }}>
                        <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3" style={{ color: "var(--primary)" }} /> Today&apos;s Quests</span>
                        <span>{xpState.quests.filter(q => q.completed).length}/{xpState.quests.length}</span>
                      </div>
                      <div className="space-y-2.5">
                        {xpState.quests.map((q) => (
                          <div key={q.id} className="flex items-center gap-2.5">
                            <div className="shrink-0 h-5 w-5 rounded-md flex items-center justify-center text-[10px]"
                              style={{ background: q.completed ? "color-mix(in oklab, var(--success) 18%, transparent)" : "var(--border)", color: q.completed ? "var(--success)" : "var(--muted-foreground)" }}>
                              {q.completed ? "✓" : "·"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs leading-none mb-1 truncate" style={{ color: q.completed ? "var(--muted-foreground)" : "var(--foreground)", textDecoration: q.completed ? "line-through" : "none" }}>
                                {q.title}
                              </div>
                              <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                                <div className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${(q.progress / q.target) * 100}%`, background: q.completed ? "var(--success)" : "var(--primary)" }} />
                              </div>
                            </div>
                            <div className="shrink-0 text-[10px] font-mono" style={{ color: q.completed ? "var(--success)" : "var(--muted-foreground)" }}>
                              {q.progress}/{q.target} +{q.reward}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <NextBestActionPanel tab={tab} setTab={setTab} progress={lectureProgress} />
                    <ConceptsPanel concepts={studyMaterials.concepts} />
                    <StatsPanel lecture={result.lecture} materials={studyMaterials} />
                    <AchievementsPanel achievements={lectureProgress.achievements} />
                    {(result.insights || insightsLoading || insightsError) && (
                      <div className="surface rounded-xl p-4">
                        <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Difficulty</div>
                        {insightsLoading && !result.insights ? (
                          <div className="space-y-2">
                            <div className="h-4 w-32 rounded-md animate-pulse" style={{ background: "var(--border)" }} />
                            <div className="h-3 w-full rounded-md animate-pulse" style={{ background: "var(--border)" }} />
                            <div className="h-3 w-[85%] rounded-md animate-pulse" style={{ background: "var(--border)" }} />
                            <p className="text-[11px] mt-2 flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
                              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              Generating insights in the background…
                            </p>
                          </div>
                        ) : result.insights ? (
                          <>
                            <div className="text-sm font-semibold capitalize mb-0.5">{result.insights.difficulty}</div>
                            <div className="text-[11px] leading-snug space-y-0.5" style={{ color: "var(--muted-foreground)" }}>
                              <div>~{result.insights.estimatedStudyMinutes} min extra practice typical</div>
                              <div className="opacity-80">beyond watching; faster or slower depends on you</div>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px]" style={{ color: "var(--destructive)" }}>{insightsError}</p>
                        )}
                      </div>
                    )}
                  </aside>
                </div>
                </div>
              </main>

              <button onClick={reset} className="lg:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-glow flex items-center justify-center z-40"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                <Plus className="h-6 w-6" />
              </button>
            </motion.div>
          )}

          {/* ══ FACULTY: private teaching audit ══ */}
          {appMode === "faculty" && !facultyReport && !facultyLoading && (
            <motion.main key="faculty-hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 px-4 py-10 md:py-16">
              <div className="mx-auto max-w-2xl">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] mb-3" style={{ color: "var(--muted-foreground)" }}>Capability 2 · Faculty</p>
                <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-3">Private lecture audit</h1>
                <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--muted-foreground)" }}>
                  Capability 2: voluntary private audit mapped to pedagogical reasoning, accessibility, equity and inclusion, and clarity — with a prioritized, timestamped fix list when (and only when) substantive risks appear. Uses transcript evidence processed for this audit; polishing nitpicks are omitted for experienced instructors. When majors are absent, strengths are surfaced so you still see what is already working.
                </p>
                <form onSubmit={(e) => { e.preventDefault(); submitFaculty(); }} className="space-y-4">
                  <div className="surface rounded-2xl p-2 shadow-elegant flex gap-2">
                    <input type="url" value={facultyUrl} onChange={(e) => setFacultyUrl(e.target.value)}
                      placeholder="Paste your lecture YouTube URL…"
                      className="flex-1 bg-transparent border-0 outline-none text-sm py-3 px-3 min-w-0"
                      style={{ color: "var(--foreground)" }} />
                    <button type="submit" disabled={!facultyUrl.trim()}
                      className="shrink-0 px-5 py-3 rounded-xl text-sm font-medium disabled:opacity-40"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}>
                      Run audit
                    </button>
                  </div>
                  {facultyError && (
                    <p className="text-sm px-4 py-3 rounded-xl border" style={{ color: "var(--destructive)", borderColor: "color-mix(in oklab, var(--destructive) 25%, transparent)" }}>{facultyError}</p>
                  )}
                </form>
              </div>
            </motion.main>
          )}
          {appMode === "faculty" && facultyLoading && (
            <motion.main key="faculty-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center py-24 px-4">
              {/* Research / document-analysis graphic */}
              <div className="relative mb-10 w-44 h-44">
                {/* Document silhouette */}
                <svg viewBox="0 0 176 176" className="absolute inset-0 w-full h-full">
                  {/* Page body */}
                  <rect x="44" y="22" width="88" height="112" rx="6"
                    fill="color-mix(in oklab, var(--surface-elevated) 100%, transparent)"
                    stroke="var(--border)" strokeWidth="1.5" />
                  {/* Folded corner */}
                  <path d="M112 22 L132 42 L112 42 Z" fill="var(--border)" opacity="0.5" />
                  {/* Text lines — highlight sweeps over them */}
                  {[38, 54, 68, 82, 96, 110, 124].map((y, i) => (
                    <rect key={i} x="58" y={y} width={i % 3 === 2 ? 44 : 60} height="5" rx="2"
                      fill="color-mix(in oklab, var(--muted-foreground) 18%, transparent)" />
                  ))}
                  {/* Animated highlight line sweeping top-to-bottom */}
                  <motion.rect x="52" y="0" width="72" height="12" rx="3"
                    fill="color-mix(in oklab, var(--primary) 22%, transparent)"
                    initial={{ y: 34 }}
                    animate={{ y: [34, 126, 34] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  {/* Animated underline marker */}
                  <motion.rect x="58" y="0" width="60" height="2.5" rx="1.5"
                    fill="var(--primary)" opacity="0.7"
                    initial={{ y: 42 }}
                    animate={{ y: [42, 134, 42] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </svg>
                {/* Magnifying glass orbiting the document */}
                <motion.div className="absolute" style={{ top: 0, left: 0, width: "100%", height: "100%" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 7, repeat: Infinity, ease: "linear" }}>
                  <div className="absolute" style={{ top: "8px", left: "50%", transform: "translateX(-50%)" }}>
                    <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center"
                      style={{ borderColor: "var(--primary)", background: "color-mix(in oklab, var(--primary) 14%, var(--background))" }}>
                      <Search className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} />
                    </div>
                  </div>
                </motion.div>
                {/* Checkmark badges appearing */}
                {[
                  { top: "30%", right: "-8px", delay: 0 },
                  { top: "55%", right: "-8px", delay: 0.8 },
                  { top: "75%", right: "-8px", delay: 1.6 },
                ].map((pos, i) => (
                  <motion.div key={i} className="absolute w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ top: pos.top, right: pos.right, background: "color-mix(in oklab, var(--success) 20%, var(--background))", border: "1.5px solid color-mix(in oklab, var(--success) 50%, transparent)" }}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1, 1, 0.5] }}
                    transition={{ duration: 2.4, repeat: Infinity, delay: pos.delay, ease: "easeInOut" }}>
                    <CheckCircle2 className="h-3 w-3" style={{ color: "var(--success)" }} />
                  </motion.div>
                ))}
              </div>
              <p className="font-serif text-xl">Auditing your lecture…</p>
              <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>Major flaws only • colleague-level restraint • full sampled transcript to the model</p>
              <p className="text-sm mt-4 italic max-w-lg text-center" style={{ color: "var(--muted-foreground)" }}>&ldquo;{loadingQuote}&rdquo;</p>
            </motion.main>
          )}
          {appMode === "faculty" && facultyReport && (
            <motion.main key="faculty-report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 px-4 md:px-8 py-8">
              <FacultyAuditPanels report={facultyReport} meta={facultyMeta ?? { videoId: "", title: "Lecture", channelName: "" }} />
            </motion.main>
          )}

          {/* ══ PROVOST: curriculum map ══ */}
          {appMode === "provost" && !provostReport && !provostLoading && (
            <motion.main key="provost-hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 px-4 py-10 md:py-16">
              <div className="mx-auto max-w-3xl space-y-6">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: "var(--muted-foreground)" }}>Capability 3 · Provost</p>
                <h1 className="font-serif text-3xl md:text-4xl tracking-tight">Curriculum coverage map</h1>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                  Capability 3: paste multiple URLs from one course plus the objectives as they appear in your catalog, accreditation packet, syllabus, or marketing copy. Lecturemate fingerprints transcript evidence lecture-by-lecture, compares execution to those promises at a glance, and flags where objectives look strong versus under-served or missing. Stewardship tooling for accountable leaders — not individualized student surveillance.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider mb-2 block" style={{ color: "var(--muted-foreground)" }}>Lecture URLs (one per line, max 10)</label>
                    <textarea value={provostUrlsText} onChange={(e) => setProvostUrlsText(e.target.value)}
                      rows={10}
                      className="w-full rounded-xl border p-3 text-sm font-mono resize-y outline-none scroll-thin"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                      placeholder={"https://youtube.com/watch?v=...\nhttps://..."} />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider mb-2 block" style={{ color: "var(--muted-foreground)" }}>Learning objectives (one per line)</label>
                    <textarea value={provostObjectivesText} onChange={(e) => setProvostObjectivesText(e.target.value)}
                      rows={8}
                      className="w-full rounded-xl border p-3 text-sm resize-y outline-none"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                      placeholder={"Students will be able to...\n..."} />
                  </div>
                </div>
                {provostError && (
                  <p className="text-sm px-4 py-3 rounded-xl border" style={{ color: "var(--destructive)", borderColor: "color-mix(in oklab, var(--destructive) 25%, transparent)" }}>{provostError}</p>
                )}
                <button type="button" onClick={submitProvost}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>
                  Generate map <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.main>
          )}
          {appMode === "provost" && provostLoading && (
            <motion.main key="provost-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center py-24 px-4">
              {/* Animated grid map graphic */}
              <div className="relative mb-8 w-32 h-32">
                <svg viewBox="0 0 128 128" className="absolute inset-0 w-full h-full">
                  {/* Grid lines */}
                  {[0,1,2,3].map(r => (
                    <line key={`h${r}`} x1="8" y1={8 + r * 37} x2="120" y2={8 + r * 37}
                      stroke="var(--border)" strokeWidth="1" />
                  ))}
                  {[0,1,2,3].map(c => (
                    <line key={`v${c}`} x1={8 + c * 37} y1="8" x2={8 + c * 37} y2="120"
                      stroke="var(--border)" strokeWidth="1" />
                  ))}
                  {/* Coverage cells appearing one by one */}
                  {[[0,0,"H"],[1,1,"M"],[2,2,"H"],[0,2,"L"],[1,0,"M"],[2,1,"H"],[0,1,"H"],[2,0,"L"]].map(([c,r,lvl], i) => (
                    <motion.rect key={i}
                      x={Number(c) * 37 + 10} y={Number(r) * 37 + 10}
                      width="33" height="33" rx="4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.7 }}
                      transition={{ delay: i * 0.35, duration: 0.4, repeat: Infinity, repeatDelay: 3 }}
                      fill={lvl === "H" ? "color-mix(in oklab, var(--success) 40%, transparent)" : lvl === "M" ? "color-mix(in oklab, var(--warning) 35%, transparent)" : "color-mix(in oklab, var(--muted-foreground) 15%, transparent)"}
                    />
                  ))}
                </svg>
                {/* Scanning line */}
                <motion.div className="absolute left-0 right-0 h-px"
                  style={{ background: "var(--primary)", boxShadow: "0 0 8px var(--primary)" }}
                  animate={{ top: ["10%", "90%", "10%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
              </div>
              <p className="font-serif text-xl">Mapping lectures to objectives…</p>
              <p className="text-sm mt-2 max-w-md text-center" style={{ color: "var(--muted-foreground)" }}>
                Transcripts and rich per-lecture fingerprints run in parallel, then the curriculum map merges all evidence for leadership QA.
              </p>
              <p className="text-sm mt-4 italic max-w-lg text-center" style={{ color: "var(--muted-foreground)" }}>&ldquo;{loadingQuote}&rdquo;</p>
            </motion.main>
          )}
          {appMode === "provost" && provostReport && (
            <motion.main key="provost-report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 px-4 md:px-8 py-8">
              <ProvostCurriculumPanels report={provostReport} perVideo={provostPerVideo} />
            </motion.main>
          )}

          {/* Creator tools unlock modal */}
          {unlockOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setUnlockOpen(false)} />
              <div className="relative w-full max-w-md surface rounded-2xl p-6 border shadow-elegant"
                style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Creator tools</p>
                    <h3 className="font-serif text-2xl mt-1">Unlock faculty/provost</h3>
                  </div>
                  <button onClick={() => setUnlockOpen(false)} className="opacity-60 hover:opacity-100 transition">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--muted-foreground)" }}>
                  This is a demo guardrail so students don’t accidentally open private audits. It’s stored only in your browser.
                </p>
                <div className="surface rounded-xl p-2 border flex gap-2" style={{ borderColor: "var(--border)" }}>
                  <input value={unlockCode} onChange={(e) => setUnlockCode(e.target.value)}
                    placeholder="Enter access code"
                    className="flex-1 bg-transparent border-0 outline-none text-sm py-2 px-3"
                    style={{ color: "var(--foreground)" }} />
                  <button onClick={unlockCreatorTools}
                    className="px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    Unlock
                  </button>
                </div>
                {unlockError && (
                  <p className="text-sm mt-3" style={{ color: "var(--destructive)" }}>{unlockError}</p>
                )}
                <p className="text-[10px] mt-4 font-mono" style={{ color: "var(--muted-foreground)" }}>
                  Hint (hackathon): code is <span style={{ color: "var(--foreground)" }}>lecturemate</span>
                </p>
              </div>
            </div>
          )}

        </AnimatePresence>

        <footer className="border-t py-8 mt-16 shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <p className="font-mono uppercase tracking-wider">Lecturemate AI <span className="mx-2 opacity-40">/</span> Cloudforce Hackathon 2026</p>
            <p className="font-mono uppercase tracking-wider opacity-70">Powered by Claude Sonnet · Amazon Bedrock</p>
          </div>
        </footer>

        </div>
      </div>

      {/* Adaptive learning check-in modal */}
      {checkInOpen && (
        <CheckInModal
          lectureTitle={result?.lecture?.title}
          onDone={handleCheckInDone}
          onSkip={handleCheckInSkip}
        />
      )}

      {/* XP toast notifications */}
      <XPToastContainer
        toasts={xpToasts}
        onDismiss={(id) => setXpToasts((t) => t.filter((x) => x.id !== id))}
      />
    </div>
  );
}

/* ─── Faculty audit report ─── */
function FacultyAuditPanels({ report, meta }: { report: FacultyAuditReport; meta: { videoId: string; title: string; channelName: string } }) {
  const sortedFixes = [...(report.fixes ?? [])].sort((a, b) => a.priority - b.priority);
  /** Major findings list is the sole signal (matches server rules; avoids stale caches). */
  const publicationReady = sortedFixes.length === 0;
  const top3 = sortedFixes.slice(0, 3);
  const rest = sortedFixes.slice(3);
  const pedagogyDim = report.pedagogy ?? [];
  const accessibilityDim = report.accessibility ?? [];
  const equityDim = report.equity ?? [];
  const clarityDim = report.clarity ?? [];
  const workingWell = report.workingWell ?? [];
  const hasDimensionNotes =
    pedagogyDim.length > 0 || accessibilityDim.length > 0 || equityDim.length > 0 || clarityDim.length > 0;
  const displayVerdict = publicationReady
    ? report.oneThingToFix?.trim() || FACULTY_DEFAULT_PUBLICATION_READY
    : report.oneThingToFix;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
          Private audit for you • cached in this browser only • transcript processed server-side solely to generate this briefing • not learner surveillance
        </p>
        <h2 className="font-serif text-2xl md:text-3xl tracking-tight mb-1">{meta.title || "Lecture"}</h2>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{meta.channelName} · {meta.videoId}</p>
      </div>

      <div className="surface rounded-2xl p-6 border shadow-card" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: publicationReady ? "var(--success)" : "var(--primary)" }}>
            {publicationReady ? "Publication ready" : "If you change one thing before publishing"}
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md"
            style={{ background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}>
            Private
          </span>
        </div>
        {!publicationReady && (
          <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Highest-impact systemic finding for an experienced instructor (Capability 2). Timestamped majors and rewrite ideas appear below only when warranted.
          </p>
        )}
        <p className="text-lg font-medium leading-relaxed">{displayVerdict}</p>
        {publicationReady && (
          <p className="text-xs mt-4 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            We only escalate publication-blocking concerns from transcript evidence. Decorative polish stays off your radar on purpose.
          </p>
        )}
      </div>

      {publicationReady && workingWell.length > 0 && (
        <div className="surface rounded-2xl p-6 border shadow-card" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-serif text-xl leading-tight mb-1">What is already working</h3>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Balancing the rubric: strengths drawn from observable transcript cues across pedagogy, accessibility, inclusion, and clarity.
          </p>
          <ul className="text-sm space-y-2 list-disc pl-5" style={{ color: "var(--foreground)" }}>
            {workingWell.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {!publicationReady && workingWell.length > 0 && (
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h4 className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Still working despite the gaps</h4>
          <ul className="text-sm space-y-1.5 list-disc pl-5" style={{ color: "var(--foreground)" }}>
            {workingWell.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {!publicationReady && (
        <div className="surface rounded-2xl p-6 border shadow-card" style={{ borderColor: "var(--border)" }}>
          <div className="mb-4">
            <h3 className="font-serif text-xl leading-tight">Major findings</h3>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
              Substantive items only — expand for rationale and suggested wording where offered.
            </p>
          </div>
          <div className="space-y-3">
            {top3.map((f, i) => (
              <details key={i} className="surface rounded-xl border" style={{ borderColor: "var(--border)" }}>
                <summary className="cursor-pointer list-none px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md"
                        style={{ background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}>P{f.priority}</span>
                      {f.timestamp !== undefined && (
                        <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>@ {formatTime(f.timestamp)}</span>
                      )}
                    </div>
                    <div className="font-medium truncate">{f.title}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{f.rationale}</p>
                  {f.suggestedRewrite && (
                    <div className="mt-3 text-sm rounded-lg p-3" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}>
                      <span className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: "var(--muted-foreground)" }}>Suggested rewrite</span>
                      {f.suggestedRewrite}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
          {rest.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--foreground)" }}>
                View {rest.length} more major item{rest.length === 1 ? "" : "s"}
              </summary>
              <div className="space-y-3 mt-3">
                {rest.map((f, i) => (
                  <details key={i} className="surface rounded-xl border" style={{ borderColor: "var(--border)" }}>
                    <summary className="cursor-pointer list-none px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md"
                            style={{ background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}>P{f.priority}</span>
                          {f.timestamp !== undefined && (
                            <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>@ {formatTime(f.timestamp)}</span>
                          )}
                        </div>
                        <div className="font-medium">{f.title}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
                    </summary>
                    <div className="px-4 pb-4">
                      <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{f.rationale}</p>
                      {f.suggestedRewrite && (
                        <div className="mt-3 text-sm rounded-lg p-3" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}>
                          <span className="text-[10px] font-mono uppercase tracking-wider block mb-1" style={{ color: "var(--muted-foreground)" }}>Suggested rewrite</span>
                          {f.suggestedRewrite}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {hasDimensionNotes && (
        <div className="grid sm:grid-cols-2 gap-4">
          <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Pedagogy & structure</summary>
            <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
              {pedagogyDim.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
          <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Accessibility</summary>
            <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
              {accessibilityDim.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
          <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Equity & inclusion</summary>
            <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
              {equityDim.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
          <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
            <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Clarity</summary>
            <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
              {clarityDim.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

function ProvostCurriculumPanels({
  report,
  perVideo,
}: {
  report: CurriculumMapReport;
  perVideo: { videoId: string; url: string; metadata?: { title: string; channelName: string }; error?: string }[] | null;
}) {
  const covColor: Record<string, string> = {
    High: "var(--success)",
    Medium: "var(--warning)",
    Low: "color-mix(in oklab, var(--muted-foreground) 80%, transparent)",
    Missing: "var(--destructive)",
  };

  const rows = report.objectiveCoverage;
  const tally = rows.reduce(
    (acc, r) => {
      acc[r.coverageLevel] += 1;
      return acc;
    },
    { High: 0, Medium: 0, Low: 0, Missing: 0 } as Record<ObjectiveCoverageRow["coverageLevel"], number>,
  );

  const underServed = rows.filter((r) => r.coverageLevel === "Low" || r.coverageLevel === "Missing");
  const stronglyCovered = rows.filter((r) => r.coverageLevel === "High");

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
          Leadership QA briefing • Capability 3 • cached in this browser • evidence from transcripts, not syllabi-only intent
        </p>
        <h2 className="font-serif text-2xl md:text-3xl tracking-tight mb-2">Curriculum coverage map</h2>
        <p className="text-sm leading-relaxed max-w-3xl" style={{ color: "var(--muted-foreground)" }}>{report.overallNotes}</p>
      </div>

      <section className="surface rounded-2xl p-5 border shadow-card space-y-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-serif text-lg leading-tight">At a glance: objectives versus what lectures showed</h3>
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          High signals multiple transcript touchpoints aligning with an objective; Medium is partial; Low is thin exposure; Missing is no usable fingerprint linkage to the objective text you supplied.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Strong coverage", n: tally.High, color: covColor.High },
            { label: "Partial", n: tally.Medium, color: covColor.Medium },
            { label: "Thin exposure", n: tally.Low, color: covColor.Low },
            { label: "Missing", n: tally.Missing, color: covColor.Missing },
          ].map(({ label, n, color }) => (
            <span
              key={label}
              className="inline-flex items-baseline gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}
            >
              <span style={{ fontWeight: 600, color }}>{n}</span>
              <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
            </span>
          ))}
        </div>

        {(underServed.length > 0 || stronglyCovered.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4 pt-2">
            {underServed.length > 0 && (
              <div className="rounded-xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--destructive) 25%, transparent)" }}>
                <h4 className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--destructive)" }}>Under-served or absent</h4>
                <ul className="text-sm space-y-2 list-disc pl-4" style={{ color: "var(--foreground)" }}>
                  {underServed.map((r, i) => (
                    <li key={i}>
                      <span className="font-mono text-[10px] mr-2" style={{ color: covColor[r.coverageLevel] }}>[{r.coverageLevel}]</span>
                      {r.objective}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stronglyCovered.length > 0 && (
              <div className="rounded-xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--success) 30%, transparent)" }}>
                <h4 className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--success)" }}>Well supported in lecture evidence</h4>
                <ul className="text-sm space-y-2 list-disc pl-4" style={{ color: "var(--foreground)" }}>
                  {stronglyCovered.map((r, i) => (
                    <li key={i}>{r.objective}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {perVideo && perVideo.some((p) => p.error) && (
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }}>
          <h4 className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--warning)" }}>Lecture ingest notes</h4>
          <ul className="text-xs space-y-1 font-mono" style={{ color: "var(--muted-foreground)" }}>
            {perVideo.map((p, i) => (
              <li key={i}>{p.metadata?.title ?? p.url}{p.error ? ` — ${p.error}` : " — OK"}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="font-serif text-xl mb-4">Detailed objective coverage</h3>
        <div className="space-y-4">
          {rows.map((row, i) => (
            <div key={i} className="surface rounded-xl p-5 border" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <p className="font-medium flex-1 min-w-0">{row.objective}</p>
                <span className="text-[10px] font-mono uppercase px-2 py-1 rounded-md shrink-0" style={{ background: "var(--surface-elevated)", color: covColor[row.coverageLevel] ?? "var(--foreground)" }}>
                  {row.coverageLevel}
                </span>
              </div>
              {row.evidence.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {row.evidence.map((e, j) => (
                    <li key={j} className="pl-3 border-l-2" style={{ borderColor: "var(--border)" }}>
                      <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{e.lectureTitle} @ {formatTime(e.timestamp)}</span>
                      <p className="mt-0.5" style={{ color: "var(--muted-foreground)" }}>{e.quoteOrParaphrase}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>No transcript-backed evidence surfaced in fingerprints for this objective.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }}>
          <h4 className="font-serif text-lg mb-2">Stewardship gaps</h4>
          <p className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Risks to catalog promises or accreditation language</p>
          <ul className="text-sm list-disc pl-4 space-y-1" style={{ color: "var(--muted-foreground)" }}>
            {report.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }}>
          <h4 className="font-serif text-lg mb-2">Redundancies</h4>
          <p className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Potential overlap hiding schedule for missing depth</p>
          <ul className="text-sm list-disc pl-4 space-y-1" style={{ color: "var(--muted-foreground)" }}>
            {report.redundancies.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ─── Chapter Rail (left sidebar — navigation only) ─── */
function ChapterRail({ lecture, activeSection, onSeek }: { lecture: StructuredLecture; activeSection: number; onSeek: (s: number, idx: number) => void }) {
  return (
    <div className="lg:sticky lg:top-20">
      <div className="text-[11px] font-mono uppercase tracking-[0.18em] mb-4 flex items-center justify-between" style={{ color: "var(--muted-foreground)" }}>
        <span>Chapters</span>
        <span>{lecture.sections.length} total</span>
      </div>
      <div className="space-y-0.5 max-h-[72vh] overflow-y-auto scroll-thin pr-1">
        {lecture.sections.map((s, i) => {
          const active = i === activeSection;
          return (
            <button key={i} onClick={() => onSeek(s.startTime, i)}
              className="w-full text-left flex items-start gap-3 py-2.5 px-2 rounded-lg transition group"
              style={{ background: active ? "color-mix(in oklab, var(--primary) 7%, transparent)" : undefined }}>
              <span className="font-mono text-[10px] tabular-nums shrink-0 mt-0.5 pt-px"
                style={{ color: active ? "var(--primary)" : "color-mix(in oklab, var(--muted-foreground) 60%, transparent)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] leading-snug"
                  style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: active ? 500 : undefined }}>
                  {s.title}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock className="h-2.5 w-2.5" style={{ color: "color-mix(in oklab, var(--muted-foreground) 50%, transparent)" }} />
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: "color-mix(in oklab, var(--muted-foreground) 50%, transparent)" }}>
                    {formatTime(s.startTime)}
                  </span>
                </div>
              </div>
              {active && <span className="h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--primary)" }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Stats & Concepts ─── */
function StatsPanel({ lecture, materials }: { lecture: StructuredLecture; materials: StudyMaterials }) {
  const stats = [
    { label: "Chapters", value: lecture.sections.length },
    { label: "Cards", value: materials.flashcards.length },
    { label: "Concepts", value: materials.concepts.length },
  ];
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: "var(--muted-foreground)" }}>Workspace stats</div>
      <div className="grid grid-cols-3 divide-x surface rounded-xl overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {stats.map((s) => (
          <div key={s.label} className="p-3 text-center">
            <div className="font-serif text-2xl tabular-nums leading-none">{s.value}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider mt-1" style={{ color: "var(--muted-foreground)" }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptsPanel({ concepts }: { concepts: string[] }) {
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-[0.18em] mb-3 flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
        <Sparkles className="h-3 w-3" style={{ color: "var(--primary)" }} /> Key Concepts
      </div>
      <div className="flex flex-wrap gap-1.5">
        {concepts.map((c, i) => (
          <motion.span key={c} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
            className="text-xs px-2.5 py-1 rounded-md surface cursor-default hover:opacity-80 transition">
            {c}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function ProgressPanel({
  lecture,
  materials,
  progress,
}: {
  lecture: StructuredLecture;
  materials: StudyMaterials;
  progress: LectureProgress;
}) {
  const totalSections = lecture.sections.length || 1;
  const totalCards = materials.flashcards.length || 1;
  const sectionsPct = Math.round((progress.sectionsCompleted.length / totalSections) * 100);
  const cardsPct = Math.round((progress.cardsReviewed.length / totalCards) * 100);
  
  // Calculate video watch percentage based on focusSeconds vs total lecture duration
  const lastSectionEnd = lecture.sections.length > 0
    ? lecture.sections[lecture.sections.length - 1].startTime + 300 // estimate: last section + 5 min
    : 3600;
  const totalDuration = Math.max(lastSectionEnd, 60);
  const videoPct = Math.min(100, Math.round((progress.focusSeconds / totalDuration) * 100));
  
  // Overall now includes video watching as the primary factor (40% weight)
  const overall = Math.round(
    videoPct * 0.4 +
    sectionsPct * 0.2 +
    cardsPct * 0.15 +
    (progress.chatUsed ? 100 : 0) * 0.1 +
    (progress.searchUsed ? 100 : 0) * 0.05 +
    (progress.quizScore !== null ? 100 : 0) * 0.1
  );

  return (
    <div className="surface-elevated rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
          <Target className="h-3 w-3" style={{ color: "var(--primary)" }} /> Lecture progress
        </div>
        <span className="font-serif text-xl tabular-nums">{overall}%</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden mb-4">
        <motion.div className="h-full gradient-warm" initial={{ width: 0 }} animate={{ width: `${overall}%` }} transition={{ duration: 0.6 }} />
      </div>
      <div className="space-y-2 text-xs">
        <ProgressRow label="Video watched" value={`${Math.floor(progress.focusSeconds / 60)}m`} pct={videoPct} />
        <ProgressRow label="Chapters explored" value={`${progress.sectionsCompleted.length}/${totalSections}`} pct={sectionsPct} />
        <ProgressRow label="Flashcards reviewed" value={`${progress.cardsReviewed.length}/${totalCards}`} pct={cardsPct} />
        <ProgressRow label="Asked the chatbot" value={progress.chatUsed ? "✓" : "-"} pct={progress.chatUsed ? 100 : 0} />
        <ProgressRow label="Used search" value={progress.searchUsed ? "✓" : "-"} pct={progress.searchUsed ? 100 : 0} />
        <ProgressRow label="Quiz" value={progress.quizScore !== null ? `${progress.quizScore}%` : "-"} pct={progress.quizScore ?? 0} />
      </div>
    </div>
  );
}

function ProgressRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <span style={{ color: "color-mix(in oklab, var(--muted-foreground) 85%, transparent)" }} className="flex-1">
        {label}
      </span>
      <span className="font-mono tabular-nums" style={{ color: "color-mix(in oklab, var(--foreground) 92%, transparent)" }}>
        {value}
      </span>
      <div className="h-1 w-12 bg-border rounded-full overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: "var(--primary)" }} />
      </div>
    </div>
  );
}

/* ─── Engagement panels (Lovable-style, minimal port) ─── */
function NextBestActionPanel({
  tab,
  setTab,
  progress,
}: {
  tab: DashTab;
  setTab: (t: DashTab) => void;
  progress: LectureProgress;
}) {
  const suggestion = useMemo(() => {
    if (progress.sectionsCompleted.length === 0) return { tab: "outline" as DashTab, title: "Skim the outline", desc: "Get the lay of the land in 30 seconds." };
    if (!progress.chatUsed) return { tab: "chat" as DashTab, title: "Ask Lecturemate a question", desc: "The assistant knows this lecture cold." };
    if (progress.cardsReviewed.length < 3) return { tab: "flashcards" as DashTab, title: "Review 3 flashcards", desc: "Active recall locks in the concepts." };
    if (progress.quizScore === null) return { tab: "quiz" as DashTab, title: "Take the quick quiz", desc: "A 2-minute check on what stuck." };
    if (!progress.searchUsed) return { tab: "find" as DashTab, title: "Use semantic search", desc: "Find the exact moment a concept is explained." };
    return { tab: "insights" as DashTab, title: "Scan the insights", desc: "Collect the key takeaways and next steps." };
  }, [progress]);

  if (suggestion.tab === tab) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 border relative overflow-hidden"
      style={{
        borderColor: "color-mix(in oklab, var(--primary) 35%, transparent)",
        background: "color-mix(in oklab, var(--primary) 6%, transparent)",
      }}
    >
      <div className="absolute -right-4 -bottom-4 opacity-15 pointer-events-none">
        <Mascot className="h-24 w-24" />
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2 flex items-center gap-2" style={{ color: "var(--primary)" }}>
        <Sparkles className="h-3 w-3" /> Next best action
      </div>
      <div className="font-serif text-lg leading-tight mb-1">{suggestion.title}</div>
      <p className="text-xs mb-3 max-w-[220px]" style={{ color: "var(--muted-foreground)" }}>{suggestion.desc}</p>
      <button
        onClick={() => setTab(suggestion.tab)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        Let&apos;s go <ChevronRight className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

function fmtClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FocusBlockPanel({
  progress,
  onChange,
  onGoal,
}: {
  progress: LectureProgress;
  onChange: (seconds: number) => void;
  onGoal: () => void;
}) {
  const goal = 25 * 60;
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => onChange(progress.focusSeconds + 1), 1000);
    return () => clearInterval(t);
  }, [running, onChange, progress.focusSeconds]);

  useEffect(() => {
    if (progress.focusSeconds >= goal) {
      setRunning(false);
      onGoal();
    }
  }, [progress.focusSeconds, onGoal]);

  const pct = Math.min(100, (progress.focusSeconds / goal) * 100);

  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: "var(--muted-foreground)" }}>
          Focus block
        </div>
        <span className="font-serif text-xl tabular-nums">{fmtClock(progress.focusSeconds)}</span>
      </div>
      <div className="h-1 bg-border rounded-full overflow-hidden mb-3">
        <motion.div className="h-full" style={{ background: "var(--primary)" }} animate={{ width: `${pct}%` }} transition={{ duration: 0.25 }} />
      </div>
      <div className="flex items-center gap-2">
        {!running ? (
          <button
            onClick={() => setRunning(true)}
            className="flex-1 h-8 rounded-lg border text-xs font-medium hover:opacity-80 transition"
            style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}
          >
            Start
          </button>
        ) : (
          <button
            onClick={() => setRunning(false)}
            className="flex-1 h-8 rounded-lg border text-xs font-medium hover:opacity-80 transition"
            style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}
          >
            Pause
          </button>
        )}
        <button
          onClick={() => { setRunning(false); onChange(0); }}
          className="h-8 w-8 rounded-lg border hover:opacity-80 transition grid place-items-center"
          style={{ borderColor: "var(--border)", background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}
          aria-label="Reset focus timer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="text-[10px] mt-2 text-center" style={{ color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)" }}>
        Goal: 25 min · then take a break
      </div>
    </div>
  );
}

function AchievementsPanel({ achievements }: { achievements: Achievement[] }) {
  if (!achievements || achievements.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-[0.18em] mb-3 flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
        <Trophy className="h-3 w-3" style={{ color: "var(--primary)" }} /> Achievements
      </div>
      <div className="space-y-1.5">
        {achievements.slice(0, 4).map((a) => (
          <div key={a.id} className="surface rounded-lg p-2.5 flex items-start gap-2">
            <div className="h-7 w-7 rounded-md gradient-warm flex items-center justify-center shrink-0">
              <Trophy className="h-3.5 w-3.5" style={{ color: "var(--primary-foreground)" }} />
            </div>
            <div>
              <div className="text-xs font-medium leading-tight">{a.title}</div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Summary Tab ─── */
function SummaryTab({ materials, skillLevel }: { materials: StudyMaterials; skillLevel?: SkillLevel }) {
  const [mode, setMode] = useState<"short" | "medium" | "full">("medium");
  const modes = [
    { id: "short" as const, label: "TL;DR", time: "90 sec" },
    { id: "medium" as const, label: "Standard", time: "5 min" },
    { id: "full" as const, label: "Deep dive", time: "12 min" },
  ];

  const levelBadge: Record<string, { label: string; color: string }> = {
    beginner:     { label: "Beginner mode", color: "var(--success)" },
    intermediate: { label: "Standard mode", color: "var(--primary)" },
    advanced:     { label: "Advanced mode", color: "var(--warning)" },
  };
  const badge = skillLevel ? levelBadge[skillLevel] : null;

  // ── Bilingual support ──────────────────────────────────────────────────────
  const LANGUAGES: Record<string, string> = {
    es: "Español", fr: "Français", de: "Deutsch", hi: "हिंदी",
    zh: "中文", ja: "日本語", pt: "Português", ar: "العربية",
    ko: "한국어", it: "Italiano",
  };
  const [activeLang, setActiveLang] = useState("");
  const [translating, setTranslating] = useState(false);
  // key: "${lang}:::${mode}" — all three modes are fetched in parallel on language select
  const [cache, setCache] = useState<Record<string, string>>({});
  const [langOpen, setLangOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // When language changes: fire 3 parallel fetches (short + medium + full) at once.
  // By the time the user clicks a different depth tab, it's already cached → instant.
  useEffect(() => {
    if (!activeLang) return;

    const allModes: Array<"short" | "medium" | "full"> = ["short", "medium", "full"];
    const toFetch = allModes.filter(m => !cache[`${activeLang}:::${m}`]);
    if (toFetch.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTranslating(true);

    let remaining = toFetch.length;

    toFetch.forEach(m => {
      fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ content: materials.summaries[m], targetLang: activeLang }),
      })
        .then(r => r.json())
        .then(data => {
          if (typeof data.translated === "string") {
            setCache(prev => ({ ...prev, [`${activeLang}:::${m}`]: data.translated as string }));
          }
        })
        .catch(err => { if (err.name !== "AbortError") console.error("[translate]", err); })
        .finally(() => {
          remaining--;
          if (remaining <= 0 && !controller.signal.aborted) setTranslating(false);
        });
    });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLang]);

  const cancel = () => {
    abortRef.current?.abort();
    setTranslating(false);
    setActiveLang("");
    setLangOpen(false);
  };

  const displayText = (activeLang && cache[`${activeLang}:::${mode}`])
    ? cache[`${activeLang}:::${mode}`]
    : materials.summaries[mode];
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-serif text-2xl">The lecture, <em style={{ color: "var(--primary)" }}>distilled</em>.</h3>
          {badge && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border"
              style={{ color: badge.color, borderColor: `color-mix(in oklab, ${badge.color} 40%, transparent)`, background: `color-mix(in oklab, ${badge.color} 10%, transparent)` }}>
              {badge.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Language picker */}
          <div className="relative">
            {translating ? (
              <button onClick={cancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition"
                style={{ borderColor: "var(--warning)", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 8%, transparent)" }}>
                <Loader2 className="h-3 w-3 animate-spin" />
                Translating…
                <X className="h-3 w-3 ml-0.5 opacity-70" />
              </button>
            ) : (
              <button onClick={() => setLangOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition hover:opacity-80"
                style={{
                  borderColor: activeLang ? "var(--primary)" : "var(--border)",
                  color: activeLang ? "var(--primary)" : "var(--muted-foreground)",
                  background: activeLang ? "color-mix(in oklab, var(--primary) 8%, transparent)" : "transparent",
                }}>
                <Languages className="h-3 w-3" />
                {activeLang ? LANGUAGES[activeLang] : "Translate"}
                {activeLang && (
                  <span onClick={(e) => { e.stopPropagation(); cancel(); }}
                    className="ml-0.5 opacity-60 hover:opacity-100 transition">
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            )}
            {langOpen && !translating && (
              <div className="absolute right-0 top-full mt-1 z-50 rounded-xl border shadow-lg overflow-hidden"
                style={{ background: "var(--surface)", borderColor: "var(--border)", minWidth: "9rem" }}>
                {activeLang && (
                  <button onClick={() => { cancel(); setLangOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 transition border-b"
                    style={{ borderColor: "var(--border)", color: "var(--primary)" }}>
                    ✕ English (original)
                  </button>
                )}
                {Object.entries(LANGUAGES).map(([code, label]) => (
                  <button key={code} onClick={() => { setActiveLang(code); setLangOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 transition"
                    style={{ color: activeLang === code ? "var(--primary)" : "var(--foreground)" }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Depth selector */}
          <div className="flex items-center gap-1 surface rounded-lg p-1">
            {modes.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className="relative px-3 py-1.5 rounded-md text-xs font-medium transition"
                style={{ color: mode === m.id ? "var(--background)" : "var(--muted-foreground)" }}>
                {mode === m.id && (
                  <motion.div layoutId="summary-bg" className="absolute inset-0 rounded-md"
                    style={{ background: "var(--foreground)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                )}
                <span className="relative">{m.label} <span className="opacity-60 font-mono ml-1">{m.time}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={mode + activeLang} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
          className={translating && activeLang && !cache[`${activeLang}:::${mode}`] ? "opacity-40 pointer-events-none" : ""}>
          {displayText.split(/\n\n+/).filter((p) => p.trim()).map((block, i) => (
            <div key={i} className="mb-4 text-[15px] leading-relaxed [&_ul]:my-2 [&_ol]:my-2" style={{ color: "color-mix(in oklab, var(--foreground) 88%, transparent)" }}>
              {renderChatMarkdown(block.trim())}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ─── Outline Tab (shows summaries per section — different from chapter rail) ─── */
function OutlineTab({ lecture, activeSection, onSeek }: { lecture: StructuredLecture; activeSection: number; onSeek: (s: number, idx: number) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number) => setOpen(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div>
      <h3 className="font-serif text-2xl mb-6">Lecture breakdown</h3>
      <div className="space-y-2">
        {lecture.sections.map((s, i) => {
          const isOpen = open.has(i);
          const active = i === activeSection;
          return (
            <div key={i} className="rounded-xl border overflow-hidden transition-all"
              style={{ borderColor: active ? "color-mix(in oklab, var(--primary) 30%, transparent)" : "var(--border)" }}>
              <div onClick={() => toggle(i)} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && toggle(i)}
                className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:opacity-90 transition"
                style={{ background: active ? "color-mix(in oklab, var(--primary) 5%, transparent)" : "var(--surface)" }}>
                <span className="font-mono text-xs tabular-nums w-6 shrink-0" style={{ color: active ? "var(--primary)" : "var(--muted-foreground)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-sm font-medium">{s.title}</span>
                <button onClick={(e) => { e.stopPropagation(); onSeek(s.startTime, i); }}
                  className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md transition hover:opacity-80"
                  style={{ color: "var(--primary)", background: "color-mix(in oklab, var(--primary) 10%, transparent)" }}>
                  <Play className="h-2.5 w-2.5 fill-current" /> {formatTime(s.startTime)}
                </button>
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{isOpen ? "▲" : "▼"}</span>
              </div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{s.summary}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Flashcards Tab ─── */
function FlashcardsTab({
  materials,
  onSeek,
  reviewed,
  onReviewed,
}: {
  materials: StudyMaterials;
  onSeek: (s: number) => void;
  reviewed: number[];
  onReviewed: (idx: number) => void;
}) {
  const orderedCards = useMemo(() => sortFlashcardsChronologically(materials.flashcards), [materials.flashcards]);

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const reviewedSet = useMemo(() => new Set(reviewed), [reviewed]);

  // ── Bilingual support ──────────────────────────────────────────────────────
  const LANGUAGES: Record<string, string> = {
    es: "Español", fr: "Français", de: "Deutsch", hi: "हिंदी",
    zh: "中文", ja: "日本語", pt: "Português", ar: "العربية",
    ko: "한국어", it: "Italiano",
  };
  const [activeLang, setActiveLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [cardCache, setCardCache] = useState<Record<string, typeof orderedCards>>({});
  const [langOpen, setLangOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => {
    abortRef.current?.abort();
    setTranslating(false);
    setActiveLang("");
    setLangOpen(false);
  };

  const translateCards = (lang: string) => {
    setLangOpen(false);
    if (!lang) { cancel(); return; }
    if (cardCache[lang]) { setActiveLang(lang); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveLang(lang);
    setTranslating(true);

    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ content: orderedCards, targetLang: lang }),
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.translated)) {
          setCardCache(prev => ({ ...prev, [lang]: data.translated as typeof orderedCards }));
        }
      })
      .catch(err => { if (err.name !== "AbortError") console.error("[translate]", err); })
      .finally(() => setTranslating(false));
  };

  const cards = (activeLang && cardCache[activeLang]) ? cardCache[activeLang] : orderedCards;
  // ──────────────────────────────────────────────────────────────────────────

  const card = cards[idx];
  const total = cards.length;
  const nav = (dir: 1 | -1) => { setFlipped(false); setTimeout(() => setIdx((i) => (i + dir + total) % total), 120); };

  // Auto-mark as reviewed when user flips the card
  const handleFlip = useCallback(() => {
    setFlipped(f => {
      const nextFlipped = !f;
      if (nextFlipped && !reviewedSet.has(idx)) onReviewed(idx);
      return nextFlipped;
    });
  }, [idx, reviewedSet, onReviewed]);

  if (!card) return <div className="text-center py-16 text-sm" style={{ color: "var(--muted-foreground)" }}>No flashcards available.</div>;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-serif text-2xl">Flashcards</h3>
        <div className="flex items-center gap-3">
          {/* Language picker */}
          <div className="relative">
            {translating ? (
              <button onClick={cancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition"
                style={{ borderColor: "var(--warning)", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 8%, transparent)" }}>
                <Loader2 className="h-3 w-3 animate-spin" />
                Translating…
                <X className="h-3 w-3 ml-0.5 opacity-70" />
              </button>
            ) : (
              <button onClick={() => setLangOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition hover:opacity-80"
                style={{
                  borderColor: activeLang ? "var(--primary)" : "var(--border)",
                  color: activeLang ? "var(--primary)" : "var(--muted-foreground)",
                  background: activeLang ? "color-mix(in oklab, var(--primary) 8%, transparent)" : "transparent",
                }}>
                <Languages className="h-3 w-3" />
                {activeLang ? LANGUAGES[activeLang] : "Translate"}
                {activeLang && (
                  <span onClick={(e) => { e.stopPropagation(); cancel(); }}
                    className="ml-0.5 opacity-60 hover:opacity-100 transition">
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            )}
            {langOpen && !translating && (
              <div className="absolute right-0 top-full mt-1 z-50 rounded-xl border shadow-lg overflow-hidden"
                style={{ background: "var(--surface)", borderColor: "var(--border)", minWidth: "9rem" }}>
                {activeLang && (
                  <button onClick={() => { cancel(); setLangOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 transition border-b"
                    style={{ borderColor: "var(--border)", color: "var(--primary)" }}>
                    ✕ English (original)
                  </button>
                )}
                {Object.entries(LANGUAGES).map(([code, label]) => (
                  <button key={code} onClick={() => translateCards(code)}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 transition"
                    style={{ color: activeLang === code ? "var(--primary)" : "var(--foreground)" }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="font-mono text-xs tabular-nums" style={{ color: "var(--muted-foreground)" }}>
            {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1 mb-5">
        {cards.map((_, i) => (
          <button key={i} onClick={() => { setFlipped(false); setIdx(i); }}
            className="h-1 rounded-full transition-all"
            style={{
              width: i === idx ? "2rem" : "0.4rem",
              background: reviewedSet.has(i)
                ? "var(--primary)"
                : i === idx ? "var(--foreground)" : "var(--border)",
            }} />
        ))}
      </div>

      {/* overflow-hidden + will-change prevent the 3D card from causing page-layout shift / scrollbar flash */}
      <div className="perspective-1000 mb-5" style={{ overflow: "hidden", borderRadius: "1rem" }}>
        <motion.div className="relative w-full preserve-3d cursor-pointer"
          style={{ height: "300px", willChange: "transform" }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.55, type: "spring", stiffness: 90, damping: 20 }}
          onClick={handleFlip}>
          {/* Front */}
          <div className="absolute inset-0 backface-hidden rounded-2xl surface-elevated p-7 shadow-card flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: "var(--muted-foreground)" }}>
                Question
                {reviewedSet.has(idx) && (
                  <span className="ml-2 inline-flex items-center gap-1" style={{ color: "var(--primary)" }}>
                    <CheckCircle2 className="h-3 w-3 inline" /> read
                  </span>
                )}
              </span>
              <button onClick={(e) => { e.stopPropagation(); onSeek(card.timestamp); }}
                className="text-xs font-mono flex items-center gap-1.5 transition hover:opacity-70" style={{ color: "var(--muted-foreground)" }}>
                <Play className="h-3 w-3" /> {formatTime(card.timestamp)}
              </button>
            </div>
            <div className="flex-1 flex items-center">
              <p className="font-serif text-2xl md:text-3xl leading-[1.2] tracking-tight">{card.question}</p>
            </div>
            <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)" }}>Tap to reveal answer →</p>
          </div>
          {/* Back */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl p-7 shadow-elegant flex flex-col"
            style={{ background: "var(--foreground)", color: "var(--background)" }}>
            <div className="flex items-center justify-between mb-5">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] opacity-60">Answer</span>
              <button onClick={(e) => { e.stopPropagation(); onSeek(card.timestamp); }}
                className="text-xs font-mono flex items-center gap-1.5 opacity-70 hover:opacity-100 transition" style={{ color: "var(--background)" }}>
                <Play className="h-3 w-3" /> {formatTime(card.timestamp)}
              </button>
            </div>
            <div className="flex-1 flex items-center">
              <p className="text-base leading-relaxed opacity-95">{card.answer}</p>
            </div>
            <p className="text-[11px] font-mono uppercase tracking-wider opacity-40">← Tap to flip back</p>
          </div>
        </motion.div>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => nav(-1)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm transition hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <button onClick={() => nav(1)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm transition hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Find in Lecture Tab ─── */
function FindTab({ lecture, onSeek, onUsed }: { lecture: StructuredLecture; onSeek: (s: number) => void; onUsed: () => void }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confStyle = (c: string) =>
    c === "high" ? { color: "var(--success)", border: "color-mix(in oklab, var(--success) 40%, transparent)", bg: "color-mix(in oklab, var(--success) 10%, transparent)" } :
    c === "medium" ? { color: "var(--warning)", border: "color-mix(in oklab, var(--warning) 40%, transparent)", bg: "color-mix(in oklab, var(--warning) 10%, transparent)" } :
    { color: "var(--destructive)", border: "color-mix(in oklab, var(--destructive) 40%, transparent)", bg: "color-mix(in oklab, var(--destructive) 10%, transparent)" };

  const run = async (val: string) => {
    if (!val.trim() || val.trim().length < 3) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: val.trim(), lecture }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Search failed.");
      else {
        setResult(data);
        onUsed();
      }
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <h3 className="font-serif text-2xl mb-1">Find any moment.</h3>
      <p className="text-sm mb-5" style={{ color: "var(--muted-foreground)" }}>
        Ask a question. AI locates the exact timestamp in the lecture where it&apos;s answered.
      </p>

      <div className="relative mb-3 surface rounded-xl transition focus-within:border-opacity-80">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(q)}
          placeholder="e.g. How does self-attention work?"
          className="w-full pl-11 pr-4 py-3.5 bg-transparent border-0 outline-none text-[15px]"
          style={{ color: "var(--foreground)" }} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-[11px] font-mono uppercase tracking-wider self-center" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>Try</span>
        {["What's the main concept?", "What examples were given?", "How does it work?"].map((ex) => (
          <button key={ex} onClick={() => { setQ(ex); run(ex); }}
            className="text-xs px-3 py-1.5 rounded-full border transition hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            {ex}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 p-4 surface rounded-xl">
            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--primary)" }} />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Scanning the lecture for the best match…</p>
          </motion.div>
        )}
        {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm" style={{ color: "var(--destructive)" }}>{error}</motion.p>}
        {result && !loading && (() => {
          const cs = confStyle(result.confidence);
          return (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="surface rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition"
              onClick={() => onSeek(result.timestamp)}>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border"
                  style={{ color: cs.color, borderColor: cs.border, background: cs.bg }}>
                  {result.confidence} confidence
                </span>
                <span className="font-mono text-xs flex items-center gap-1.5 tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                  <Play className="h-3 w-3" /> Jump to {formatTime(result.timestamp)}
                </span>
              </div>
              <div className="p-5 flex gap-3">
                <Quote className="h-4 w-4 mt-1 shrink-0 opacity-30" style={{ color: "var(--muted-foreground)" }} />
                <div>
                  <p className="font-serif italic text-[17px] leading-relaxed mb-2" style={{ color: "color-mix(in oklab, var(--foreground) 90%, transparent)" }}>
                    {result.excerpt}
                  </p>
                  {result.context && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{result.context}</p>}
                </div>
              </div>
            </motion.div>
          );
        })()}
        {!result && !loading && !error && (
          <div className="text-center py-14 text-sm border border-dashed rounded-xl" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            Type a question above. AI will find the exact moment in the lecture.
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// QuizTab
// ──────────────────────────────────────────────────────────────────────────
type QuizDifficulty = "easy" | "medium" | "hard";

const QUIZ_Q_COUNT_BY_LEVEL: Record<string, number> = {
  beginner:     8,
  intermediate: 10,
  advanced:     12,
};

function QuizTab({ materials, skillLevel, onCompleted }: {
  materials: StudyMaterials;
  skillLevel?: SkillLevel;
  onCompleted: (pct: number, weakTopics: string[]) => void;
}) {
  const cards = useMemo(
    () => sortFlashcardsChronologically(materials.flashcards.filter((c) => c.question && c.answer)),
    [materials.flashcards],
  );
  const [difficulty, setDifficulty] = useState<QuizDifficulty | null>(null);
  const [quizRound, setQuizRound] = useState(0);

  const quizCount = QUIZ_Q_COUNT_BY_LEVEL[skillLevel ?? "intermediate"] ?? 10;

  const shuffledCards = useMemo(
    () => {
      const sorted = [...cards].sort(() => Math.random() - 0.5);
      return sorted.slice(0, Math.min(quizCount, cards.length));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, quizCount, quizRound]
  );

  const makeOptions = useCallback((card: typeof cards[0], idx: number, diff: QuizDifficulty): { options: string[]; correct: string } => {
    const correct = card.answer;
    const others = cards.filter((_, i) => i !== idx);

    let distractors: string[];
    if (diff === "easy") {
      distractors = [...others].sort(() => Math.random() - 0.5).slice(0, 3).map((c) => c.answer);
    } else if (diff === "medium") {
      const sameSection = others.filter((c) => c.sectionTitle === card.sectionTitle);
      const rest = others.filter((c) => c.sectionTitle !== card.sectionTitle);
      const pool = [...sameSection.sort(() => Math.random() - 0.5), ...rest.sort(() => Math.random() - 0.5)];
      distractors = pool.slice(0, 3).map((c) => c.answer);
    } else {
      const firstWord = correct.split(" ")[0].toLowerCase();
      const lookalike = others.filter((c) => c.answer.toLowerCase().startsWith(firstWord));
      const rest = others.filter((c) => !c.answer.toLowerCase().startsWith(firstWord));
      const pool = [...lookalike.sort(() => Math.random() - 0.5), ...rest.sort(() => Math.random() - 0.5)];
      distractors = pool.slice(0, 3).map((c) => c.answer);
    }
    return { options: [...distractors, correct].sort(() => Math.random() - 0.5), correct };
  }, [cards]);

  const [qIdx, setQIdx] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [correctAnswer, setCorrectAnswer] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [wrongTopics, setWrongTopics] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [reasoningSubmitted, setReasoningSubmitted] = useState(false);

  const total = shuffledCards.length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  const completedRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    if (done && !completedRef.current) {
      completedRef.current = true;
      onCompletedRef.current(pct, [...new Set(wrongTopics)]);
    }
  }, [done, pct, wrongTopics]);

  useEffect(() => {
    if (!difficulty || !shuffledCards.length || qIdx >= shuffledCards.length) return;
    const card = shuffledCards[qIdx];
    const { options: opts, correct } = makeOptions(card, cards.indexOf(card), difficulty);
    setOptions(opts);
    setCorrectAnswer(correct);
  }, [qIdx, difficulty, shuffledCards, makeOptions, cards]);

  const handleAnswer = (opt: string) => {
    if (selected) return;
    const correct = opt === correctAnswer;
    setSelected(opt);
    const newStreak = correct ? streak + 1 : 0;
    setStreak(newStreak);
    if (newStreak > bestStreak) setBestStreak(newStreak);
    if (correct) setScore((s) => s + 1);
    else {
      const card = shuffledCards[qIdx];
      if (card?.sectionTitle) setWrongTopics((t) => [...t, card.sectionTitle]);
    }
    setResults((r) => [...r, correct]);
  };

  const next = () => {
    if (qIdx + 1 >= shuffledCards.length) { setDone(true); return; }
    setSelected(null);
    setReasoning("");
    setReasoningSubmitted(false);
    setQIdx((i) => i + 1);
  };

  const restart = (newDiff?: QuizDifficulty) => {
    setQIdx(0); setSelected(null); setScore(0); setStreak(0);
    setBestStreak(0); setDone(false); setResults([]); setWrongTopics([]);
    setReasoning(""); setReasoningSubmitted(false);
    completedRef.current = false;
    setQuizRound((r) => r + 1);
    if (newDiff) setDifficulty(newDiff);
  };

  if (cards.length < 2) {
    return (
      <div className="text-center py-20">
        <Trophy className="h-10 w-10 mx-auto mb-4 opacity-40" />
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Not enough flashcards to start a quiz. Process a longer lecture.</p>
      </div>
    );
  }

  // ── Difficulty picker ──
  if (!difficulty) {
    const suggestedDiff: QuizDifficulty =
      skillLevel === "beginner" ? "easy" : skillLevel === "advanced" ? "hard" : "medium";
    return (
      <div className="max-w-lg mx-auto text-center py-8">
        <Trophy className="h-10 w-10 mx-auto mb-4" style={{ color: "var(--primary)" }} />
        <h3 className="font-serif text-3xl mb-2">Quick Quiz</h3>
        <p className="text-sm mb-2" style={{ color: "var(--muted-foreground)" }}>
          {quizCount} questions · Pick your difficulty
        </p>
        {skillLevel && (
          <p className="text-[10px] font-mono uppercase tracking-wider mb-8" style={{ color: "var(--primary)" }}>
            Suggested for your level: {suggestedDiff}
          </p>
        )}
        {!skillLevel && <div className="mb-8" />}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            { d: "easy" as QuizDifficulty,   emoji: "🟢", label: "Easy",   desc: "Pick the right answer from clearly different choices." },
            { d: "medium" as QuizDifficulty, emoji: "🟡", label: "Medium", desc: "Choices are from the same section. Read carefully." },
            { d: "hard" as QuizDifficulty,   emoji: "🔴", label: "Hard",   desc: "All answers look similar. Only one is exactly right." },
          ]).map(({ d, emoji, label, desc }) => (
            <motion.button key={d} whileTap={{ scale: 0.96 }} onClick={() => setDifficulty(d)}
              className="surface rounded-2xl p-5 text-left hover:shadow-card transition group relative"
              style={d === suggestedDiff && skillLevel ? { boxShadow: "0 0 0 2px var(--primary)" } : undefined}>
              {d === suggestedDiff && skillLevel && (
                <span className="absolute top-2 right-2 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ background: "color-mix(in oklab, var(--primary) 15%, transparent)", color: "var(--primary)" }}>
                  Suggested
                </span>
              )}
              <div className="text-2xl mb-3">{emoji}</div>
              <div className="font-semibold mb-1">{label}</div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  // ── Result screen ──
  if (done) {
    const grade = pct >= 80 ? { emoji: "🏆", label: "Outstanding!", color: "var(--success)" }
      : pct >= 60 ? { emoji: "⭐", label: "Good job!", color: "var(--primary)" }
      : { emoji: "📚", label: "Keep studying!", color: "var(--warning)" };
    const uniqueWeakTopics = [...new Set(wrongTopics)];
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 max-w-lg mx-auto">
        <div className="text-5xl mb-4">{grade.emoji}</div>
        <h3 className="font-serif text-3xl mb-1" style={{ color: grade.color }}>{grade.label}</h3>
        <p className="text-sm mb-8" style={{ color: "var(--muted-foreground)" }}>You scored {score}/{total} · Best streak: {bestStreak}</p>

        {/* Score ring */}
        <div className="flex justify-center mb-8">
          <div className="relative w-32 h-32">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="8" />
              <motion.circle cx="50" cy="50" r="42" fill="none" stroke={grade.color} strokeWidth="8"
                strokeLinecap="round" strokeDasharray={2 * Math.PI * 42}
                initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - pct / 100) }}
                transition={{ duration: 1.2, ease: "easeOut" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-serif text-3xl font-semibold">{pct}%</span>
            </div>
          </div>
        </div>

        {/* Per-question recap */}
        <div className="grid grid-cols-5 gap-1.5 mb-6 justify-center">
          {results.map((r, i) => (
            <div key={i} className="h-2 rounded-full" style={{ background: r ? "var(--success)" : "var(--destructive)" }} />
          ))}
        </div>

        {/* Topics to focus on */}
        {uniqueWeakTopics.length > 0 && (
          <div className="text-left surface rounded-xl p-4 mb-8">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--destructive)" }}>Topics to revisit</p>
            <ul className="space-y-1">
              {uniqueWeakTopics.map((t) => (
                <li key={t} className="text-sm flex items-center gap-2" style={{ color: "var(--muted-foreground)" }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--destructive)" }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={() => restart()} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition"
            style={{ background: "var(--foreground)", color: "var(--background)" }}>
            <RotateCcw className="h-4 w-4" /> More questions
          </button>
          <button onClick={() => restart(difficulty === "easy" ? "medium" : difficulty === "medium" ? "hard" : "easy")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition surface">
            Try {difficulty === "hard" ? "easy" : difficulty === "medium" ? "hard" : "medium"}
          </button>
          <button onClick={() => { setDifficulty(null); restart(); }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition surface">
            Change difficulty
          </button>
        </div>
      </motion.div>
    );
  }

  const q = shuffledCards[qIdx];
  const progress = (qIdx / total) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5" style={{ color: "var(--primary)" }} />
          <span className="font-mono text-sm">{qIdx + 1} / {total}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {streak >= 2 && (
            <motion.div key={streak} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="flex items-center gap-1 font-medium" style={{ color: "var(--warning)" }}>
              <Star className="h-3.5 w-3.5 fill-current" /> {streak} streak
            </motion.div>
          )}
          <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>Score: {score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full mb-8 overflow-hidden" style={{ background: "var(--border)" }}>
        <motion.div className="h-full rounded-full" style={{ background: "var(--primary)" }}
          animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
      </div>

      {/* Question card */}
      <AnimatePresence mode="wait">
        <motion.div key={qIdx} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.22 }}>
          <div className="surface rounded-2xl p-6 sm:p-8 mb-6 shadow-card">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>
              {q.sectionTitle} · {difficulty?.toUpperCase()}
            </div>
            <p className="text-lg sm:text-xl font-medium leading-relaxed">{q.question}</p>
            {difficulty === "hard" && (
              <p className="text-[10px] font-mono uppercase tracking-wider mt-2" style={{ color: "var(--warning)" }}>
                ⚠ All options look similar, choose precisely
              </p>
            )}
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {options.map((opt, i) => {
              const isCorrect = opt === correctAnswer;
              const isSelected = selected === opt;
              const revealed = selected !== null;
              let bg = "var(--surface)";
              let border = "var(--border)";
              let textColor = "var(--foreground)";
              if (revealed && isCorrect) { bg = "color-mix(in oklab, var(--success) 15%, transparent)"; border = "var(--success)"; textColor = "var(--success)"; }
              else if (revealed && isSelected && !isCorrect) { bg = "color-mix(in oklab, var(--destructive) 15%, transparent)"; border = "var(--destructive)"; textColor = "var(--destructive)"; }
              return (
                <motion.button key={`${qIdx}-${i}`} whileTap={{ scale: 0.97 }}
                  onClick={() => handleAnswer(opt)} disabled={!!selected}
                  className="w-full text-left rounded-xl p-4 border text-sm leading-relaxed transition-all"
                  style={{ background: bg, borderColor: border, color: textColor, cursor: selected ? "default" : "pointer" }}>
                  <span className="font-mono text-[10px] mr-2 uppercase" style={{ opacity: 0.5 }}>{["A","B","C","D"][i]}</span>
                  {opt}
                  {revealed && isCorrect && <Check className="h-4 w-4 inline ml-2 float-right mt-0.5" />}
                  {revealed && isSelected && !isCorrect && <X className="h-4 w-4 inline ml-2 float-right mt-0.5" />}
                </motion.button>
              );
            })}
          </div>

          {selected && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-3">
              {/* Show correct answer explanation */}
              <div className="rounded-xl border p-4" style={{
                borderColor: selected === correctAnswer
                  ? "color-mix(in oklab, var(--success) 40%, transparent)"
                  : "color-mix(in oklab, var(--destructive) 40%, transparent)",
                background: selected === correctAnswer
                  ? "color-mix(in oklab, var(--success) 6%, transparent)"
                  : "color-mix(in oklab, var(--destructive) 6%, transparent)"
              }}>
                <p className="text-sm font-medium mb-1" style={{ color: selected === correctAnswer ? "var(--success)" : "var(--destructive)" }}>
                  {selected === correctAnswer ? "✅ Correct!" : "❌ Incorrect"}
                </p>
                {selected !== correctAnswer && (
                  <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    The correct answer is: <span className="font-medium" style={{ color: "var(--foreground)" }}>{correctAnswer}</span>
                  </p>
                )}
              </div>

              {/* Advanced: reasoning box shown when answer is wrong */}
              {skillLevel === "advanced" && selected !== correctAnswer && !reasoningSubmitted && (
                <div className="rounded-xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--warning) 40%, transparent)", background: "color-mix(in oklab, var(--warning) 6%, transparent)" }}>
                  <p className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: "var(--warning)" }}>
                    ✦ Explain your reasoning: what led you to that choice?
                  </p>
                  <textarea
                    className="w-full rounded-lg border bg-transparent text-sm p-2.5 resize-none outline-none focus:ring-1"
                    style={{ borderColor: "var(--border)", color: "var(--foreground)", minHeight: "72px" }}
                    placeholder="Write a sentence or two..."
                    value={reasoning}
                    onChange={(e) => setReasoning(e.target.value)}
                  />
                  <button
                    onClick={() => setReasoningSubmitted(true)}
                    className="mt-2 text-xs font-medium px-3 py-1.5 rounded-lg transition hover:opacity-80"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                  >
                    Submit reflection
                  </button>
                </div>
              )}
              <div className="flex items-center justify-end">
                {(skillLevel !== "advanced" || selected === correctAnswer || reasoningSubmitted) && (
                  <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}>
                    {qIdx + 1 >= total ? "See results" : "Next"} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// InsightsTab — difficulty timeline, concept confidence, prereqs, takeaways
// ──────────────────────────────────────────────────────────────────────────
type ConfidenceLevel = "know" | "fuzzy" | "no";

function InsightsTab({
  insights,
  insightsLoading,
  insightsError,
  onRetryInsights,
  concepts,
  onSeek,
  weakTopics,
}: {
  insights?: LectureInsights;
  insightsLoading?: boolean;
  insightsError?: string | null;
  onRetryInsights?: () => void;
  concepts: string[];
  onSeek: (s: number) => void;
  weakTopics?: string[];
}) {
  const [confidence, setConfidence] = useState<Record<string, ConfidenceLevel>>({});

  const difficultyColor = { easy: "var(--success)", medium: "var(--warning)", hard: "var(--destructive)" } as const;
  const difficultyLabel = insights ? { beginner: "Beginner-friendly", intermediate: "Intermediate", advanced: "Advanced" }[insights.difficulty] : "";
  const totalDuration = insights?.difficultyTimeline?.length
    ? insights.difficultyTimeline[insights.difficultyTimeline.length - 1].endTime : 0;

  const knowCount = Object.values(confidence).filter((v) => v === "know").length;
  const fuzzyCount = Object.values(confidence).filter((v) => v === "fuzzy").length;
  const noCount = Object.values(confidence).filter((v) => v === "no").length;
  const total = concepts.length;
  const rated = knowCount + fuzzyCount + noCount;

  return (
    <div className="space-y-8">
      {insightsLoading && !insights && (
        <div className="surface rounded-xl p-6 flex flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin shrink-0" style={{ color: "var(--primary)" }} />
          <div>
            <p className="font-medium mb-1">Analyzing difficulty and takeaways</p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Summaries and flashcards are already ready. Insights load right after.
            </p>
          </div>
        </div>
      )}
      {insightsError && !insights && (
        <div className="surface rounded-xl p-6 border" style={{ borderColor: "color-mix(in oklab, var(--destructive) 35%, transparent)" }}>
          <p className="text-sm mb-4" style={{ color: "var(--destructive)" }}>{insightsError}</p>
          <button
            type="button"
            onClick={onRetryInsights}
            className="text-xs font-medium px-4 py-2 rounded-lg border transition hover:opacity-90"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            Retry insights
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-2xl">Lecture insights.</h3>
        {insights && (
          <div className="text-xs font-mono uppercase tracking-wider flex items-center gap-3" style={{ color: "var(--muted-foreground)" }}>
            <span>{difficultyLabel}</span><span className="opacity-30">·</span>
            <span title="Rough guide for notes, drills, and recall—not passive viewing, and not a judgment of your ability">
              ~{insights.estimatedStudyMinutes} min typical practice beyond the video
            </span>
          </div>
        )}
      </div>

      {/* Concept Confidence Tracker */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Concept Self-Check · {rated}/{total} rated</div>
          {rated > 0 && (
            <button onClick={() => setConfidence({})} className="text-[10px] font-mono uppercase tracking-wider hover:opacity-70 transition" style={{ color: "var(--muted-foreground)" }}>Reset</button>
          )}
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Tap each concept to rate your confidence. Your study list updates live.</p>

        {/* Progress bar */}
        {rated > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden mb-5" style={{ background: "var(--border)" }}>
            <div style={{ width: `${(knowCount / total) * 100}%`, background: "var(--success)", transition: "width 0.3s" }} />
            <div style={{ width: `${(fuzzyCount / total) * 100}%`, background: "var(--warning)", transition: "width 0.3s" }} />
            <div style={{ width: `${(noCount / total) * 100}%`, background: "var(--destructive)", transition: "width 0.3s" }} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {concepts.map((c) => {
            const level = confidence[c];
            const colors: Record<ConfidenceLevel, { bg: string; border: string; text: string }> = {
              know:  { bg: "color-mix(in oklab, var(--success) 15%, transparent)",    border: "var(--success)",     text: "var(--success)" },
              fuzzy: { bg: "color-mix(in oklab, var(--warning) 15%, transparent)",    border: "var(--warning)",     text: "var(--warning)" },
              no:    { bg: "color-mix(in oklab, var(--destructive) 15%, transparent)", border: "var(--destructive)", text: "var(--destructive)" },
            };
            const nextLevel = (cur: ConfidenceLevel | undefined): ConfidenceLevel => cur === undefined ? "know" : cur === "know" ? "fuzzy" : cur === "fuzzy" ? "no" : "know";
            const label = level === "know" ? "✓ Know it" : level === "fuzzy" ? "~ Fuzzy" : level === "no" ? "✗ No idea" : c;
            return (
              <motion.button key={c} whileTap={{ scale: 0.94 }} onClick={() => setConfidence((prev) => ({ ...prev, [c]: nextLevel(prev[c]) }))}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={level ? { background: colors[level].bg, borderColor: colors[level].border, color: colors[level].text } : { background: "var(--surface)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                {level ? label : c}
              </motion.button>
            );
          })}
        </div>

        {/* Study list */}
        {(fuzzyCount > 0 || noCount > 0) && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 surface rounded-xl p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>📋 Your study list</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(confidence).filter(([, v]) => v === "no").map(([c]) => (
                <span key={c} className="text-xs px-2.5 py-1 rounded-md" style={{ background: "color-mix(in oklab, var(--destructive) 12%, transparent)", color: "var(--destructive)" }}>✗ {c}</span>
              ))}
              {Object.entries(confidence).filter(([, v]) => v === "fuzzy").map(([c]) => (
                <span key={c} className="text-xs px-2.5 py-1 rounded-md" style={{ background: "color-mix(in oklab, var(--warning) 12%, transparent)", color: "var(--warning)" }}>~ {c}</span>
              ))}
            </div>
          </motion.div>
        )}
        {rated === total && noCount === 0 && fuzzyCount === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-center py-3 rounded-xl text-sm" style={{ background: "color-mix(in oklab, var(--success) 12%, transparent)", color: "var(--success)" }}>
            🎉 You know all {total} concepts! Great work.
          </motion.div>
        )}

        {/* Quiz weak topics */}
        {weakTopics && weakTopics.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 surface rounded-xl p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--destructive)" }}>Quiz: Topics to revisit</div>
            <p className="text-xs mb-3" style={{ color: "var(--muted-foreground)" }}>Based on your quiz answers, focus on these sections:</p>
            <div className="flex flex-wrap gap-2">
              {weakTopics.map((t) => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-md" style={{ background: "color-mix(in oklab, var(--destructive) 12%, transparent)", color: "var(--destructive)" }}>⚠ {t}</span>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Difficulty Arc — fixed text cutoff */}
      {insights && insights.difficultyTimeline.length > 0 && totalDuration > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Difficulty Arc · click a segment to jump</div>
          <div className="surface rounded-xl p-4 sm:p-5">
            {/* Stacked bar */}
            <div className="flex h-8 rounded-lg overflow-hidden mb-4">
              {insights.difficultyTimeline.map((seg, i) => {
                const w = ((seg.endTime - seg.startTime) / totalDuration) * 100;
                return (
                  <button key={i} onClick={() => onSeek(seg.startTime)} title={seg.label}
                    className="transition-opacity hover:opacity-75"
                    style={{ width: `${w}%`, background: difficultyColor[seg.difficulty] }} />
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
              {(["easy","medium","hard"] as const).map((d) => (
                <span key={d} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full shrink-0" style={{ background: difficultyColor[d] }} />{d}</span>
              ))}
            </div>
            {/* Row list — full text, no truncation */}
            <div className="space-y-1">
              {insights.difficultyTimeline.map((seg, i) => (
                <button key={i} onClick={() => onSeek(seg.startTime)}
                  className="w-full flex items-center gap-3 text-left py-2 px-3 rounded-lg hover:opacity-80 transition group"
                  style={{ background: "var(--surface-elevated)" }}>
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: difficultyColor[seg.difficulty] }} />
                  <span className="flex-1 text-sm min-w-0 break-words">{seg.label}</span>
                  <span className="font-mono text-[11px] shrink-0 ml-2" style={{ color: "var(--muted-foreground)" }}>
                    {Math.floor(seg.startTime / 60)}:{(seg.startTime % 60).toString().padStart(2, "0")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Key takeaways */}
      {insights && insights.keyTakeaways.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Key Takeaways</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {insights.keyTakeaways.map((t, i) => (
              <div key={i} className="surface rounded-xl p-5">
                <div className="font-mono text-[10px] mb-2" style={{ color: "var(--primary)" }}>0{i + 1}</div>
                <p className="text-sm leading-relaxed">{t}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prereqs + Next steps */}
      {insights && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {insights.prerequisites.length > 0 && (
            <div className="surface rounded-xl p-5">
              <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Before this lecture</div>
              <h4 className="font-serif text-lg mb-3">You should know</h4>
              <div className="flex flex-wrap gap-1.5">
                {insights.prerequisites.map((p, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-md border" style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>{p}</span>
                ))}
              </div>
            </div>
          )}
          {insights.nextSteps.length > 0 && (
            <div className="surface rounded-xl p-5">
              <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>After this lecture</div>
              <h4 className="font-serif text-lg mb-3">Study next</h4>
              <div className="flex flex-wrap gap-1.5">
                {insights.nextSteps.map((p, i) => (
                  <span key={i} className="text-xs px-2.5 py-1 rounded-md" style={{ background: "color-mix(in oklab, var(--primary) 14%, transparent)", color: "var(--primary)" }}>{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// NodePos retained for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface NodePos { x: number; y: number; vx: number; vy: number; }

function _ConceptMap_UNUSED({ concepts }: { concepts: LectureInsights["concepts"] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });

  const sorted = useMemo(
    () => [...concepts].sort((a, b) => b.importance - a.importance),
    [concepts]
  );

  const nameToIdx = useMemo(
    () => new Map(sorted.map((c, i) => [c.name.toLowerCase(), i])),
    [sorted]
  );

  const edges = useMemo<[number, number][]>(() => {
    const out: [number, number][] = [];
    sorted.forEach((c, i) => {
      c.connectsTo.forEach((other) => {
        const j = nameToIdx.get(other.toLowerCase());
        if (j !== undefined && j !== i && !out.find(([a, b]) => (a === i && b === j) || (a === j && b === i))) {
          out.push([i, j]);
        }
      });
    });
    return out;
  }, [sorted, nameToIdx]);

  // Track positions in a ref so we don't re-render every frame
  const nodesRef = useRef<NodePos[]>([]);
  const draggingRef = useRef<{ idx: number; offsetX: number; offsetY: number } | null>(null);
  const [, forceRender] = useState(0);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSize({ w: rect.width, h: Math.max(420, Math.min(620, rect.width * 0.55)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Initialize positions in a circle around the center
  useEffect(() => {
    const cx = size.w / 2, cy = size.h / 2;
    nodesRef.current = sorted.map((c, i) => {
      if (i === 0) return { x: cx, y: cy, vx: 0, vy: 0 };
      const ring = i <= 6 ? 1 : 2;
      const ringSize = ring === 1 ? Math.min(6, sorted.length - 1) : sorted.length - 7;
      const inRing = ring === 1 ? i - 1 : i - 7;
      const angle = (inRing / Math.max(1, ringSize)) * Math.PI * 2;
      const radius = ring === 1 ? Math.min(160, size.w * 0.22) : Math.min(240, size.w * 0.33);
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, vx: 0, vy: 0 };
    });
    forceRender((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length, size.w, size.h]);

  // Force simulation loop
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      if (!nodes.length) { requestAnimationFrame(tick); return; }
      const cx = size.w / 2, cy = size.h / 2;
      const N = nodes.length;
      // Repulsion (Coulomb-ish)
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist2 = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(dist2);
          const force = 9000 / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx; nodes[i].vy -= fy;
          nodes[j].vx += fx; nodes[j].vy += fy;
        }
      }
      // Spring on edges
      const desired = Math.min(160, size.w * 0.18);
      edges.forEach(([a, b]) => {
        const dx = nodes[b].x - nodes[a].x;
        const dy = nodes[b].y - nodes[a].y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const diff = (dist - desired) * 0.04;
        const fx = (dx / dist) * diff;
        const fy = (dy / dist) * diff;
        nodes[a].vx += fx; nodes[a].vy += fy;
        nodes[b].vx -= fx; nodes[b].vy -= fy;
      });
      // Centering pull (stronger on center node)
      nodes.forEach((n, i) => {
        const k = i === 0 ? 0.04 : 0.008;
        n.vx += (cx - n.x) * k;
        n.vy += (cy - n.y) * k;
      });
      // Damping + apply
      const dragging = draggingRef.current;
      const margin = 50;
      nodes.forEach((n, i) => {
        if (dragging && dragging.idx === i) return;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
        if (n.x < margin) { n.x = margin; n.vx = 0; }
        if (n.x > size.w - margin) { n.x = size.w - margin; n.vx = 0; }
        if (n.y < margin) { n.y = margin; n.vy = 0; }
        if (n.y > size.h - margin) { n.y = size.h - margin; n.vy = 0; }
      });
      forceRender((n) => n + 1);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; };
  }, [size.w, size.h, edges]);

  const startDrag = (e: React.PointerEvent, idx: number) => {
    if (!containerRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current.getBoundingClientRect();
    const node = nodesRef.current[idx];
    draggingRef.current = { idx, offsetX: e.clientX - rect.left - node.x, offsetY: e.clientY - rect.top - node.y };
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const d = draggingRef.current;
    const node = nodesRef.current[d.idx];
    node.x = e.clientX - rect.left - d.offsetX;
    node.y = e.clientY - rect.top - d.offsetY;
    node.vx = 0; node.vy = 0;
  };
  const endDrag = () => { draggingRef.current = null; };

  const isHighlighted = (i: number) => {
    if (hovered === null) return true;
    if (hovered === i) return true;
    const h = sorted[hovered];
    const linkedToHover = h.connectsTo.some((n) => nameToIdx.get(n.toLowerCase()) === i);
    const hoverLinkedHere = sorted[i].connectsTo.some((n) => nameToIdx.get(n.toLowerCase()) === hovered);
    return linkedToHover || hoverLinkedHere;
  };

  const isEdgeHighlighted = (a: number, b: number) =>
    hovered === null || hovered === a || hovered === b;

  return (
    <div ref={containerRef} className="surface rounded-xl relative overflow-hidden select-none" style={{ height: size.h }}>
      {/* Hint */}
      <div className="absolute top-3 left-3 text-[10px] font-mono uppercase tracking-wider z-20 px-2 py-1 rounded-md" style={{ color: "var(--muted-foreground)", background: "var(--surface)", border: "1px solid var(--border)" }}>
        Drag nodes · Hover to highlight
      </div>

      {/* SVG layer for edges (under nodes) */}
      <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h}>
        {edges.map(([a, b], i) => {
          const na = nodesRef.current[a], nb = nodesRef.current[b];
          if (!na || !nb) return null;
          const highlighted = isEdgeHighlighted(a, b);
          return (
            <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={hovered !== null && (a === hovered || b === hovered) ? "var(--primary)" : "var(--border)"}
              strokeWidth={hovered !== null && (a === hovered || b === hovered) ? 1.5 : 1}
              opacity={highlighted ? 0.9 : 0.15} />
          );
        })}
      </svg>

      {/* HTML nodes (text wraps natively) */}
      {sorted.map((c, i) => {
        const node = nodesRef.current[i];
        if (!node) return null;
        const isCenter = i === 0;
        const nodeSize = 70 + (c.importance / 10) * 50; // 70–120px
        const highlighted = isHighlighted(i);
        return (
          <div
            key={i}
            onPointerDown={(e) => startDrag(e, i)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className="absolute rounded-full flex items-center justify-center text-center cursor-grab active:cursor-grabbing transition-all duration-150"
            style={{
              width: nodeSize,
              height: nodeSize,
              left: node.x - nodeSize / 2,
              top: node.y - nodeSize / 2,
              background: isCenter ? "var(--primary)" : "var(--surface-elevated)",
              border: `${isCenter ? 2 : 1}px solid ${isCenter ? "var(--primary)" : (hovered === i ? "var(--primary)" : "var(--border)")}`,
              color: isCenter ? "var(--primary-foreground)" : "var(--foreground)",
              opacity: highlighted ? 1 : 0.25,
              transform: `scale(${hovered === i ? 1.06 : 1})`,
              boxShadow: hovered === i ? "0 8px 24px -8px var(--primary)" : (isCenter ? "var(--shadow-glow)" : "none"),
              zIndex: hovered === i || isCenter ? 10 : 5,
              userSelect: "none",
            }}
          >
            <span className="px-3 text-[11px] sm:text-xs font-medium leading-tight break-words"
              style={{ fontWeight: isCenter ? 600 : 500 }}>
              {c.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ChatTab — streaming lecture chatbot
// ──────────────────────────────────────────────────────────────────────────
interface ChatMessage { role: "user" | "assistant"; content: string; }

const STARTER_QUESTIONS = [
  "What are the 3 most important things I should remember?",
  "Explain the hardest concept in simple terms.",
  "What should I study before this lecture?",
  "Give me a 30-second recap.",
];

function ChatTab({ result, materials, initialHistory, onHistoryChange, onUsed, skillLevel }: {
  result: ProcessResult;
  materials: StudyMaterials;
  initialHistory: ChatMessage[];
  onHistoryChange: (h: ChatMessage[]) => void;
  onUsed: () => void;
  skillLevel?: SkillLevel;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const context = useMemo(() => ({
    title: result.lecture.title,
    channelName: result.metadata.channelName,
    sections: result.lecture.sections.map((s) => ({ title: s.title, summary: s.summary, startTime: s.startTime })),
    shortSummary: materials.summaries.short,
    concepts: materials.concepts,
  }), [result, materials]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    onUsed();
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: q };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context, skillLevel, videoId: result.videoId }),
      });
      if (!res.ok || !res.body) throw new Error("Chat request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: full }]);
      }
      // Persist completed chat to localStorage
      const finalMsgs = [...history, { role: "assistant" as const, content: full }];
      onHistoryChange(finalMsgs);
    } catch {
      const errorMsgs = [...history, { role: "assistant" as const, content: "Sorry, something went wrong. Please try again." }];
      setMessages(errorMsgs);
      onHistoryChange(errorMsgs);
    } finally {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "600px" }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in oklab, var(--primary) 15%, transparent)" }}>
          <MessageCircle className="h-4 w-4" style={{ color: "var(--primary)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm flex items-center gap-2">
            Lecturemate AI
            {skillLevel && (
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  background: skillLevel === "beginner" ? "color-mix(in oklab, var(--success) 12%, transparent)" : skillLevel === "advanced" ? "color-mix(in oklab, var(--warning) 12%, transparent)" : "color-mix(in oklab, var(--primary) 12%, transparent)",
                  color: skillLevel === "beginner" ? "var(--success)" : skillLevel === "advanced" ? "var(--warning)" : "var(--primary)",
                }}>
                {skillLevel}
              </span>
            )}
          </div>
          <div className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Powered by Claude Sonnet 4.6 · {messages.length > 0 ? `${Math.floor(messages.length / 2)} exchanges saved` : "Ask anything about this lecture"}</div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); onHistoryChange([]); }}
            className="text-[11px] px-2.5 py-1 rounded-lg hover:opacity-70 transition"
            style={{ color: "var(--muted-foreground)", background: "var(--surface-elevated)" }}>
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin space-y-4 pr-1 mb-4">
        {messages.length === 0 && (
          <div>
            <div className="text-center py-6">
              <div className="flex justify-center mb-3">
                <Mascot className="h-20 w-20 animate-float" animated />
              </div>
              <p className="font-serif text-xl mb-1">Hi, I&apos;m Lecturemate.</p>
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                I&apos;ve read the full transcript. Ask anything and I&apos;ll explain it clearly with timestamps.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="text-left text-xs px-3 py-2.5 rounded-xl border hover:opacity-80 transition leading-relaxed"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted-foreground)" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "color-mix(in oklab, var(--primary) 15%, transparent)" }}>
                <Brain className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} />
              </div>
            )}
            <div className="max-w-[82%] px-4 py-2.5 text-sm leading-relaxed"
              style={m.role === "user"
                ? { background: "var(--foreground)", color: "var(--background)", borderRadius: "1rem 1rem 0.25rem 1rem" }
                : { background: "var(--surface-elevated)", borderRadius: "1rem 1rem 1rem 0.25rem" }}>
              {m.role === "assistant"
                ? (m.content
                    ? renderChatMarkdown(m.content)
                    : (streaming && i === messages.length - 1
                        ? <span className="animate-blink" style={{ color: "var(--muted-foreground)" }}>▍</span>
                        : ""))
                : m.content}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="surface rounded-2xl flex items-center gap-2 p-1.5 shadow-card">
        <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about any concept, timestamp, or topic…"
          className="flex-1 bg-transparent border-0 outline-none text-sm py-2 px-3"
          style={{ color: "var(--foreground)" }} disabled={streaming} />
        <button onClick={() => send()} disabled={!input.trim() || streaming}
          className="h-9 w-9 rounded-xl flex items-center justify-center transition disabled:opacity-40 shrink-0"
          style={{ background: "var(--foreground)", color: "var(--background)" }}>
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
