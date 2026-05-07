"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Brain, FileText, Search, Layers,
  Sun, Moon, Plus, Play, Check, Loader2, ChevronLeft, ChevronRight,
  Quote, Sparkles, List, CheckCircle2, Clock,
  Zap, Coffee, Target, GraduationCap, BookOpen, Headphones,
  Trophy, RotateCcw, Star, X, MessageCircle, Send, LineChart, UserRound,
} from "lucide-react";
import { StructuredLecture } from "@/lib/agents/structurer";
import { StudyMaterials } from "@/lib/agents/studyMaterialGenerator";
import { SearchResult } from "@/lib/agents/semanticSearch";
import { LectureInsights } from "@/lib/agents/insights";
import type { FacultyAuditReport } from "@/lib/agents/facultyAudit";
import type { CurriculumMapReport } from "@/lib/agents/curriculumMap";

interface ProcessResult {
  videoId: string;
  metadata: { title: string; channelName: string; thumbnailUrl: string };
  lecture: StructuredLecture;
  studyMaterials: StudyMaterials;
  insights?: LectureInsights;
}

type PipelineStage = "idle" | "extracting" | "structuring" | "generating" | "complete" | "error";
type DashTab = "summary" | "outline" | "flashcards" | "quiz" | "insights" | "chat" | "find";
type AppMode = "student" | "faculty" | "provost";

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

/** Renders **bold** inline markdown — used in summary paragraphs */
function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**")
      ? <strong key={i} style={{ color: "var(--foreground)", fontWeight: 600 }}>{chunk.slice(2, -2)}</strong>
      : chunk
  );
}

/** Renders inline markdown: ***bi***, **bold**, *italic*, `code` */
function renderInline(text: string, key?: string): React.ReactNode {
  const parts = text.split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
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
  const lines = text.split("\n");
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

/** StudyAI logo SVG */
function StudyAILogo({ size = 28 }: { size?: number }) {
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

const STORAGE_KEY = "studyai_lectures";
const LAST_SESSION_KEY = "studyai_last_session";
const CREATOR_UNLOCK_KEY = "studyai_creator_unlocked";
const FACULTY_CACHE_KEY = "studyai_faculty_cache";
const PROVOST_CACHE_KEY = "studyai_provost_cache";
const MAX_SAVED = 10;
/** Recents + last-session restore expire after 7 days */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function pruneExpired(entries: SavedLecture[]): SavedLecture[] {
  const now = Date.now();
  return entries.filter((e) => now - e.savedAt <= TTL_MS);
}

function pickQuote(mode: AppMode) {
  const student = [
    "You don't learn by watching — you learn by retrieving.",
    "Small summaries. Big understanding.",
    "Clarity beats speed; focus beats noise.",
    "Turn any lecture into your personal workspace.",
    "The best review session is the one you actually do.",
    "Understanding compounds — start with the outline.",
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
    "Clear outcomes make great lectures — and vice versa.",
    "Explicit transitions: invisible when they work, priceless when missing.",
    "Accessibility is not an afterthought — it is the foundation.",
    "The best lecturers edit as obsessively as writers do.",
    "Equity in the classroom starts with equity in the explanation.",
    "What your students remember most is what you emphasised last.",
  ];
  const provost = [
    "Objectives are promises. Coverage is evidence.",
    "What's taught matters more than what's planned.",
    "Map the course. Find the gaps. Fix them.",
    "Quality assurance, grounded in real transcripts.",
    "Curriculum coherence isn't accidental — it's designed.",
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

function loadSavedLectures(): SavedLecture[] {
  if (typeof window === "undefined") return [];
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

export default function Home() {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterials | null>(null);
  const [tab, setTab] = useState<DashTab>("summary");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [activeSection, setActiveSection] = useState(0);
  const [savedLectures, setSavedLectures] = useState<SavedLecture[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyRestoredLecture = useCallback((lec: SavedLecture, tabOverride?: DashTab) => {
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
    tryRestoreLastSession();
  }, [tryRestoreLastSession]);

  useEffect(() => {
    try {
      setCreatorUnlocked(localStorage.getItem(CREATOR_UNLOCK_KEY) === "1");
    } catch {
      setCreatorUnlocked(false);
    }
  }, []);

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
    const cur = window.history.state as null | { studyai?: boolean; view?: string };
    if (!cur?.studyai || cur.view !== view) {
      window.history.pushState({ studyai: true, view, ...extra }, "", window.location.pathname);
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
      const st = e.state as null | { studyai?: boolean; view?: string; videoId?: string };
      if (!st?.studyai) {
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

  const seek = useCallback((seconds: number, sectionIdx?: number) => {
    if (sectionIdx !== undefined) setActiveSection(sectionIdx);
    if (iframeRef.current) {
      iframeRef.current.src = `https://www.youtube.com/embed/${result?.videoId}?start=${Math.floor(seconds)}&autoplay=1&rel=0`;
    }
  }, [result?.videoId]);

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
    setLoadingQuote(pickQuote("student"));
    setError(null);
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

      setResult(data);
      setStudyMaterials(data.studyMaterials);
      setChatHistory([]);
      setStage("complete");
      // Persist to localStorage
      const entry: SavedLecture = {
        id: data.videoId,
        title: data.lecture.title,
        channelName: data.metadata.channelName,
        thumbnailUrl: data.metadata.thumbnailUrl,
        savedAt: Date.now(),
        result: data,
        studyMaterials: data.studyMaterials,
        chatHistory: [],
      };
      saveLecture(entry);
      setSavedLectures(loadSavedLectures());
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
    if (code !== "studyai") {
      setUnlockError("Invalid code.");
      return;
    }
    setUnlockError(null);
    setCreatorUnlocked(true);
    try { localStorage.setItem(CREATOR_UNLOCK_KEY, "1"); } catch { /* ignore */ }
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

  return (
    <div className={theme}>
      <div className="flex min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>

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
              <StudyAILogo size={26} />
              <span className="text-[15px] font-semibold tracking-tight">StudyAI</span>
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
                    <button onClick={() => { setSavedLectures([]); localStorage.removeItem(STORAGE_KEY); }}
                      className="text-[10px] hover:opacity-70 transition" style={{ color: "var(--muted-foreground)" }}>Clear</button>
                  </div>
                  {savedLectures.map((s) => (
                    <div key={s.id}
                      className="group flex items-start gap-2 px-2 py-2.5 rounded-xl hover:opacity-80 transition cursor-pointer"
                      style={{ background: result?.videoId === s.id ? "var(--surface-elevated)" : "transparent" }}
                      onClick={() => { loadFromHistory(s); setSidebarOpen(false); }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium leading-tight truncate">{s.title}</p>
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                          {s.channelName} · {new Date(s.savedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteSavedLecture(s.id); setSavedLectures(loadSavedLectures()); }}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition shrink-0 mt-0.5"
                        style={{ color: "var(--muted-foreground)" }}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
            {/* Sidebar footer */}
            <div className="shrink-0 px-3 py-3 border-t" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm hover:opacity-80 transition"
                style={{ color: "var(--muted-foreground)" }}>
                {theme === "dark" ? <><Sun className="h-4 w-4" /> Light mode</> : <><Moon className="h-4 w-4" /> Dark mode</>}
              </button>
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
                  <StudyAILogo size={26} />
                  <span className="text-[15px] font-semibold tracking-tight">StudyAI</span>
                  <span className="hidden sm:inline text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>v1.0</span>
                </button>
              </div>
              {/* Right: new lecture + theme */}
              <div className="flex items-center gap-1">
                {result && (
                  <button onClick={reset}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition hover:opacity-80"
                    style={{ color: "var(--muted-foreground)" }}>
                    <Plus className="h-3.5 w-3.5" /> New lecture
                  </button>
                )}
                <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
                  className="h-8 w-8 flex items-center justify-center rounded-lg transition hover:opacity-80"
                  style={{ color: "var(--muted-foreground)" }}>
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </header>

        <AnimatePresence mode="wait">

          {/* ══ HERO (Student) ══ */}
          {appMode === "student" && !result && stage === "idle" && (
            <motion.main key="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1">
              <div className="relative overflow-hidden">
                <div className="absolute inset-0 -z-10">
                  <div className="absolute inset-0 grid-pattern opacity-60" />
                  <div className="absolute top-[-10%] right-[-5%] h-[500px] w-[500px] rounded-full blur-[120px] animate-float" style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)" }} />
                  <div className="absolute bottom-[-10%] left-[-5%] h-[400px] w-[400px] rounded-full blur-[120px]" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)", animation: "float 12s ease-in-out 4s infinite" }} />
                </div>

                {/* Hero section — full-width centered */}
                <section className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12 pt-12 sm:pt-20 md:pt-24 pb-16 sm:pb-24">
                  <div className="text-center">
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.16em] mb-6 sm:mb-8" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted-foreground)" }}>
                      <span className="h-1.5 w-1.5 rounded-full animate-pulse-soft" style={{ background: "var(--primary)" }} />
                      Cloudforce Hackathon · Built on Bedrock
                    </motion.div>

                    <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 }}
                      className="font-serif leading-[0.95] tracking-[-0.025em] font-semibold mb-6 sm:mb-8 max-w-5xl mx-auto" style={{ fontSize: "clamp(2.4rem, 7vw, 5.5rem)" }}>
                      Turn any YouTube lecture into your <em className="font-serif italic font-normal gradient-text">personal study workspace</em>.
                    </motion.h1>

                    <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.18 }}
                      className="text-base sm:text-lg md:text-xl leading-relaxed mb-8 sm:mb-12 max-w-2xl mx-auto px-2" style={{ color: "var(--muted-foreground)" }}>
                      AI-powered summaries, flashcards, quiz, semantic search, and a lecture-aware chatbot — generated in under 30 seconds by parallel AI agents.
                    </motion.p>

                    <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
                      onSubmit={(e) => { e.preventDefault(); submit(); }} className="max-w-2xl mx-auto">
                      <div className="surface flex items-center gap-1.5 sm:gap-2 rounded-2xl p-1.5 sm:p-2 shadow-elegant relative">
                        <div className="hidden sm:flex items-center gap-2 pl-3 pr-2 border-r shrink-0" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                          <span className="font-mono text-xs uppercase tracking-wider">URL</span>
                        </div>
                        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                          placeholder="Paste any YouTube lecture link…"
                          className="flex-1 bg-transparent border-0 outline-none text-sm sm:text-base py-3 px-3 sm:px-2 min-w-0"
                          style={{ color: "var(--foreground)" }} autoFocus />
                        <button type="submit" disabled={!url.trim()}
                          className="flex items-center gap-1.5 h-10 sm:h-11 px-4 sm:px-6 rounded-xl text-sm font-medium transition-all disabled:opacity-40 shrink-0 hover:opacity-90"
                          style={{ background: "var(--foreground)", color: "var(--background)" }}>
                          <span className="hidden sm:inline">Analyze</span>
                          <ArrowRight className="h-4 w-4" />
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

                    {/* Stats strip */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.5 }}
                      className="mt-12 sm:mt-16 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 max-w-3xl mx-auto">
                      {[
                        { v: "<30s", l: "End-to-end" },
                        { v: "4", l: "AI agents" },
                        { v: "12", l: "Languages" },
                        { v: "100%", l: "Free to use" },
                      ].map((s) => (
                        <div key={s.l} className="text-center">
                          <div className="font-serif text-2xl sm:text-3xl md:text-4xl tracking-tight" style={{ color: "var(--foreground)" }}>{s.v}</div>
                          <div className="text-[10px] sm:text-xs font-mono uppercase tracking-wider mt-1" style={{ color: "var(--muted-foreground)" }}>{s.l}</div>
                        </div>
                      ))}
                    </motion.div>
                  </div>
                </section>

                {/* Live preview / mockup */}
                <section className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12 pb-16 sm:pb-24">
                  <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.7 }}
                    className="surface rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-elegant relative overflow-hidden">
                    {/* Window chrome */}
                    <div className="flex items-center gap-1.5 mb-3 sm:mb-4 px-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: "color-mix(in oklab, var(--destructive) 70%, transparent)" }} />
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: "color-mix(in oklab, var(--warning) 70%, transparent)" }} />
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: "color-mix(in oklab, var(--success) 70%, transparent)" }} />
                      <div className="ml-3 px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}>studyai.app</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                      {/* Mock chapter rail */}
                      <div className="surface-elevated rounded-xl p-3 sm:p-4">
                        <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Chapters · 6</div>
                        {["Introduction", "Core concepts", "Real-world examples", "Common pitfalls", "Best practices", "Wrap-up"].map((t, i) => (
                          <div key={t} className="py-2 px-2 rounded-md text-xs sm:text-sm flex items-center justify-between" style={{ background: i === 1 ? "color-mix(in oklab, var(--primary) 12%, transparent)" : "transparent", color: i === 1 ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            <span className="truncate">{t}</span>
                            <span className="font-mono text-[10px] opacity-60">{Math.floor(i * 4.2).toString().padStart(2, "0")}:{(i * 13 % 60).toString().padStart(2, "0")}</span>
                          </div>
                        ))}
                      </div>
                      {/* Mock content area */}
                      <div className="md:col-span-2 surface-elevated rounded-xl p-4 sm:p-5">
                        <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Summary · Standard 5 min</div>
                        <div className="space-y-2 mb-5">
                          <div className="h-3 rounded" style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)", width: "92%" }} />
                          <div className="h-3 rounded" style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)", width: "85%" }} />
                          <div className="h-3 rounded" style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)", width: "78%" }} />
                          <div className="h-3 rounded" style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)", width: "65%" }} />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {["Backpropagation", "Gradient descent", "Loss functions", "Activation", "Regularization"].map((t) => (
                            <span key={t} className="text-[11px] px-2.5 py-1 rounded-md" style={{ background: "color-mix(in oklab, var(--primary) 14%, transparent)", color: "var(--primary)" }}>{t}</span>
                          ))}
                        </div>
                        <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                          <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Flashcard · 3 of 8</div>
                          <div className="text-sm font-medium mb-1">What problem does gradient descent solve?</div>
                          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Tap to reveal · 02:14</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </section>

                {/* Built for moments — student personas */}
                <section className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12 pb-16 sm:pb-24">
                  <div className="text-center mb-8 sm:mb-12">
                    <div className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: "var(--muted-foreground)" }}>§01 — Built for students</div>
                    <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl leading-[1.05] tracking-tight">
                      For the moments <em className="italic" style={{ color: "var(--primary)" }}>that matter</em>.
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { icon: Coffee,         t: "Cramming for finals",     d: "Turn 2-hour lectures into 90-second TL;DRs the night before." },
                      { icon: Target,         t: "Catching up after class", d: "Get the structure, key concepts, and a study deck instantly." },
                      { icon: GraduationCap,  t: "Self-learning",            d: "Build a study workspace from any expert lecture on YouTube." },
                      { icon: BookOpen,       t: "Learning in a 2nd language", d: "Translate every summary, flashcard, and concept in seconds." },
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
                <section className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-12 pb-20 sm:pb-32">
                  <div className="text-center mb-8 sm:mb-12">
                    <div className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.18em] mb-3" style={{ color: "var(--muted-foreground)" }}>§02 — How it works</div>
                    <h2 className="font-serif text-3xl sm:text-4xl md:text-5xl leading-[1.05] tracking-tight">
                      Four agents. <em className="italic" style={{ color: "var(--primary)" }}>One</em> seamless workspace.
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { icon: Headphones, n: "01", t: "Extractor",    d: "Pulls transcript and captions from any YouTube video." },
                      { icon: Layers,     n: "02", t: "Structurer",   d: "Detects chapters, key concepts, and logical outline." },
                      { icon: Sparkles,   n: "03", t: "Synthesizer",  d: "Writes 3-depth summaries and generates flashcards." },
                      { icon: Search,     n: "04", t: "Indexer",      d: "Powers semantic search and instant translation." },
                    ].map((s, i) => (
                      <motion.div key={s.n} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.06 }}
                        className="surface rounded-2xl p-5 sm:p-6 hover:shadow-card transition relative">
                        <div className="flex items-center justify-between mb-4">
                          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in oklab, var(--primary) 15%, transparent)" }}>
                            <s.icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: "var(--primary)" }} strokeWidth={1.75} />
                          </div>
                          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Agent {s.n}</span>
                        </div>
                        <h3 className="font-serif text-lg sm:text-xl mb-1.5">{s.t}</h3>
                        <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{s.d}</p>
                      </motion.div>
                    ))}
                  </div>

                  {/* Final CTA */}
                  <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
                    className="mt-16 sm:mt-24 text-center surface rounded-3xl p-8 sm:p-12 relative overflow-hidden">
                    <div className="absolute inset-0 -z-10 opacity-50" style={{ background: "radial-gradient(ellipse at center, color-mix(in oklab, var(--primary) 10%, transparent) 0%, transparent 70%)" }} />
                    <Zap className="h-7 w-7 mx-auto mb-4" style={{ color: "var(--primary)" }} />
                    <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl leading-tight tracking-tight max-w-2xl mx-auto mb-3">
                      Stop watching. Start <em className="italic" style={{ color: "var(--primary)" }}>understanding</em>.
                    </h2>
                    <p className="text-sm sm:text-base mb-6 max-w-xl mx-auto" style={{ color: "var(--muted-foreground)" }}>
                      Paste a link above to generate your first study workspace.
                    </p>
                    <button onClick={() => { document.querySelector<HTMLInputElement>('input[type="url"]')?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="inline-flex items-center gap-2 h-11 px-6 rounded-xl text-sm font-medium hover:opacity-90 transition"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}>
                      Try it now <ArrowRight className="h-4 w-4" />
                    </button>
                  </motion.div>
                </section>
              </div>
            </motion.main>
          )}

          {/* ══ PROCESSING (Student) ══ */}
          {appMode === "student" && (isProcessing || stage === "error") && !result && (
            <motion.main key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center px-4 py-16">
              <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 grid-pattern opacity-30" />
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full blur-[140px] animate-pulse-soft" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }} />
              </div>

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
                    <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Usually takes 20–35 seconds</p>
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
                    <ChapterRail lecture={result.lecture} activeSection={activeSection} onSeek={seek} />
                  </aside>

                  {/* Center */}
                  <section className="space-y-5 min-w-0">
                    <motion.div initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }}
                      className="aspect-video rounded-xl overflow-hidden border shadow-elegant"
                      style={{ borderColor: "var(--border)", background: "#000" }}>
                      <iframe ref={iframeRef}
                        src={`https://www.youtube.com/embed/${result.videoId}?rel=0`}
                        title={result.lecture.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen className="w-full h-full" />
                    </motion.div>

                    {/* Tab bar */}
                    <div className="border-b flex gap-0 overflow-x-auto scrollbar-hide" style={{ borderColor: "var(--border)" }}>
                      {([
                        { id: "summary",    label: "Summary",    icon: FileText },
                        { id: "outline",    label: "Outline",    icon: List },
                        { id: "flashcards", label: "Flashcards", icon: Layers },
                        { id: "quiz",       label: "Quiz",       icon: Trophy },
                        { id: "insights",   label: "Insights",   icon: Brain },
                        { id: "chat",       label: "Chat",       icon: MessageCircle },
                        { id: "find",       label: "Find",       icon: Search },
                        // translate tab hidden for v1 — focus on English quality
                        // { id: "translate",  label: "Translate",  icon: Languages },
                      ] as { id: DashTab; label: string; icon: typeof FileText }[]).map((t) => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                          className="relative px-4 py-3 text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-colors"
                          style={{ color: tab === t.id ? "var(--foreground)" : "var(--muted-foreground)" }}>
                          <t.icon className="h-3.5 w-3.5" strokeWidth={2} />
                          {t.label}
                          {tab === t.id && (
                            <motion.div layoutId="tab-underline" className="absolute -bottom-px left-0 right-0 h-px"
                              style={{ background: "var(--foreground)" }}
                              transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="min-h-[400px]">
                      <AnimatePresence mode="wait">
                        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                          {tab === "summary" && <SummaryTab materials={studyMaterials} />}
                          {tab === "outline" && <OutlineTab lecture={result.lecture} activeSection={activeSection} onSeek={seek} />}
                          {tab === "flashcards" && <FlashcardsTab materials={studyMaterials} onSeek={seek} />}
                          {tab === "quiz" && <QuizTab materials={studyMaterials} />}
                          {tab === "insights" && <InsightsTab insights={result.insights} concepts={studyMaterials.concepts} onSeek={seek} />}
                          {tab === "chat" && (
                            <ChatTab result={result} materials={studyMaterials}
                              initialHistory={chatHistory}
                              onHistoryChange={(h) => {
                                setChatHistory(h);
                                updateChatHistory(result.videoId, h);
                              }} />
                          )}
                          {tab === "find" && <FindTab lecture={result.lecture} onSeek={seek} />}
                          {/* translate tab removed for v1 */}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </section>

                  {/* Right */}
                  <aside className="space-y-5 min-w-0">
                    <ConceptsPanel concepts={studyMaterials.concepts} />
                    <StatsPanel lecture={result.lecture} materials={studyMaterials} />
                    {result.insights && (
                      <div className="surface rounded-xl p-4">
                        <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Difficulty</div>
                        <div className="text-sm font-semibold capitalize mb-0.5">{result.insights.difficulty}</div>
                        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>~{result.insights.estimatedStudyMinutes} min to master</div>
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
                  Voluntary, restraint-driven feedback for <em>you</em> before publishing: pedagogy, accessibility, equity, and clarity — with a prioritized fix list and timestamped rewrite ideas. Nothing here is shared with students or used for surveillance.
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
              <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>Private, restraint-driven, transcript-based</p>
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
                  Paste multiple lecture URLs from one course and your stated learning objectives. The map compares what was actually taught (from transcripts) to those objectives — for leadership QA, not student surveillance.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider mb-2 block" style={{ color: "var(--muted-foreground)" }}>Lecture URLs (one per line, max 8)</label>
                    <textarea value={provostUrlsText} onChange={(e) => setProvostUrlsText(e.target.value)}
                      rows={8}
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
              <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>Fingerprinting each video, then merging evidence</p>
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
                  Hint (hackathon): code is <span style={{ color: "var(--foreground)" }}>studyai</span>
                </p>
              </div>
            </div>
          )}

        </AnimatePresence>

        <footer className="border-t py-8 mt-16 shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="px-4 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <p className="font-mono uppercase tracking-wider">StudyAI <span className="mx-2 opacity-40">/</span> Cloudforce Hackathon 2026</p>
            <p className="font-mono uppercase tracking-wider opacity-70">Powered by Claude Sonnet · Amazon Bedrock</p>
          </div>
        </footer>

        </div>
      </div>
    </div>
  );
}

/* ─── Faculty audit report ─── */
function FacultyAuditPanels({ report, meta }: { report: FacultyAuditReport; meta: { videoId: string; title: string; channelName: string } }) {
  const sortedFixes = [...report.fixes].sort((a, b) => a.priority - b.priority);
  const top3 = sortedFixes.slice(0, 3);
  const rest = sortedFixes.slice(3);
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Private report · only on this device</p>
        <h2 className="font-serif text-2xl md:text-3xl tracking-tight mb-1">{meta.title || "Lecture"}</h2>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{meta.channelName} · {meta.videoId}</p>
      </div>
      <div className="surface rounded-2xl p-6 border shadow-card" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "var(--primary)" }}>If you change one thing</div>
        <p className="text-lg font-medium leading-relaxed">{report.oneThingToFix}</p>
      </div>
      <div className="surface rounded-2xl p-6 border shadow-card" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-serif text-xl leading-tight">Final check: top 3 changes</h3>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
              Designed to be quick for experienced instructors. Expand for full details.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md"
            style={{ background: "var(--surface-elevated)", color: "var(--muted-foreground)" }}>
            Private
          </span>
        </div>
        {report.publishReady || top3.length === 0 ? (
          <div className="rounded-xl p-4 border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              No critical changes detected. If you want, re-run after final edits for a quick double-check.
            </p>
          </div>
        ) : (
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
        )}
        {rest.length > 0 && (
          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--foreground)" }}>
              View {rest.length} more suggestions
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
      <div className="grid md:grid-cols-3 gap-4">
        <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
          <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Accessibility</summary>
          <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
            {report.accessibility.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
        <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
          <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Equity & inclusion</summary>
          <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
            {report.equity.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
        <details className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }} open={false}>
          <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Clarity</summary>
          <ul className="text-sm space-y-2 list-disc pl-4 mt-3" style={{ color: "var(--foreground)" }}>
            {report.clarity.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
      </div>
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
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <h2 className="font-serif text-2xl md:text-3xl tracking-tight mb-2">Curriculum map</h2>
        <p className="text-sm leading-relaxed max-w-3xl" style={{ color: "var(--muted-foreground)" }}>{report.overallNotes}</p>
      </div>
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
        <h3 className="font-serif text-xl mb-4">Objectives vs lectures</h3>
        <div className="space-y-4">
          {report.objectiveCoverage.map((row, i) => (
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
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>No transcript-backed evidence in fingerprints for this objective.</p>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }}>
          <h4 className="font-serif text-lg mb-2">Gaps</h4>
          <ul className="text-sm list-disc pl-4 space-y-1" style={{ color: "var(--muted-foreground)" }}>
            {report.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
        <div className="surface rounded-xl p-4 border" style={{ borderColor: "var(--border)" }}>
          <h4 className="font-serif text-lg mb-2">Redundancies</h4>
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

/* ─── Summary Tab ─── */
function SummaryTab({ materials }: { materials: StudyMaterials }) {
  const [mode, setMode] = useState<"short" | "medium" | "full">("medium");
  const modes = [
    { id: "short" as const, label: "TL;DR", time: "90 sec" },
    { id: "medium" as const, label: "Standard", time: "5 min" },
    { id: "full" as const, label: "Deep dive", time: "12 min" },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h3 className="font-serif text-2xl">The lecture, <em style={{ color: "var(--primary)" }}>distilled</em>.</h3>
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
      <AnimatePresence mode="wait">
        <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {materials.summaries[mode].split("\n\n").filter(p => p.trim()).map((para, i) => (
            <p key={i} className="leading-[1.8] mb-4 text-[15px]" style={{ color: "color-mix(in oklab, var(--foreground) 88%, transparent)" }}>
              {renderMarkdown(para)}
            </p>
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
function FlashcardsTab({ materials, onSeek }: { materials: StudyMaterials; onSeek: (s: number) => void }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = materials.flashcards;
  const card = cards[idx];
  const total = cards.length;
  const nav = (dir: 1 | -1) => { setFlipped(false); setTimeout(() => setIdx((i) => (i + dir + total) % total), 120); };

  if (!card) return <div className="text-center py-16 text-sm" style={{ color: "var(--muted-foreground)" }}>No flashcards available.</div>;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-serif text-2xl">Flashcards</h3>
        <span className="font-mono text-xs tabular-nums" style={{ color: "var(--muted-foreground)" }}>
          {String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1 mb-5">
        {cards.map((_, i) => (
          <button key={i} onClick={() => { setFlipped(false); setIdx(i); }}
            className="h-1 rounded-full transition-all" style={{ width: i === idx ? "2rem" : "0.4rem", background: i === idx ? "var(--foreground)" : "var(--border)" }} />
        ))}
      </div>

      {/* overflow-hidden + will-change prevent the 3D card from causing page-layout shift / scrollbar flash */}
      <div className="perspective-1000 mb-5" style={{ overflow: "hidden", borderRadius: "1rem" }}>
        <motion.div className="relative w-full preserve-3d cursor-pointer"
          style={{ height: "300px", willChange: "transform" }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.55, type: "spring", stiffness: 90, damping: 20 }}
          onClick={() => setFlipped(f => !f)}>
          {/* Front */}
          <div className="absolute inset-0 backface-hidden rounded-2xl surface-elevated p-7 shadow-card flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: "var(--muted-foreground)" }}>Question</span>
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
function FindTab({ lecture, onSeek }: { lecture: StructuredLecture; onSeek: (s: number) => void }) {
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
      else setResult(data);
    } catch { setError("Network error."); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <h3 className="font-serif text-2xl mb-1">Find any moment.</h3>
      <p className="text-sm mb-5" style={{ color: "var(--muted-foreground)" }}>
        Ask a question — AI locates the exact timestamp in the lecture where it&apos;s answered.
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
            Type a question above — AI will find the exact moment in the lecture.
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Translate Tab ─── */
// TranslateTab removed — focusing on English quality for v1

// ──────────────────────────────────────────────────────────────────────────
// QuizTab — multiple-choice game with score, streak and feedback
// ──────────────────────────────────────────────────────────────────────────
type QuizDifficulty = "easy" | "medium" | "hard";

const QUIZ_Q_COUNT = 10; // quiz length is always 10, independent of flashcard count

function QuizTab({ materials }: { materials: StudyMaterials }) {
  const cards = useMemo(() => materials.flashcards.filter((c) => c.question && c.answer), [materials.flashcards]);
  const [difficulty, setDifficulty] = useState<QuizDifficulty | null>(null);

  // All modes show the QUESTION → pick the correct ANSWER. Difficulty = how misleading the distractors are.
  // Capped at QUIZ_Q_COUNT so quiz length stays fixed regardless of how many flashcards exist.
  const shuffledCards = useMemo(
    () => [...cards].sort(() => Math.random() - 0.5).slice(0, Math.min(QUIZ_Q_COUNT, cards.length)),
    [cards]
  );

  const makeOptions = useCallback((card: typeof cards[0], idx: number, diff: QuizDifficulty): { options: string[]; correct: string } => {
    const correct = card.answer;
    const others = cards.filter((_, i) => i !== idx);

    let distractors: string[];
    if (diff === "easy") {
      // Easy: 3 random answers from anywhere in the deck
      distractors = [...others].sort(() => Math.random() - 0.5).slice(0, 3).map((c) => c.answer);
    } else if (diff === "medium") {
      // Medium: prefer answers from the same section (more topically related → trickier)
      const sameSection = others.filter((c) => c.sectionTitle === card.sectionTitle);
      const rest = others.filter((c) => c.sectionTitle !== card.sectionTitle);
      const pool = [...sameSection.sort(() => Math.random() - 0.5), ...rest.sort(() => Math.random() - 0.5)];
      distractors = pool.slice(0, 3).map((c) => c.answer);
    } else {
      // Hard: pick answers whose first word matches the correct answer's first word (tricky look-alike pool)
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

  useEffect(() => {
    if (!difficulty || !shuffledCards.length || qIdx >= shuffledCards.length) return;
    const card = shuffledCards[qIdx];
    const { options: opts, correct } = makeOptions(card, cards.indexOf(card), difficulty);
    setOptions(opts);
    setCorrectAnswer(correct);
  }, [qIdx, shuffledCards, makeOptions, cards, difficulty]);

  const handleAnswer = (opt: string) => {
    if (selected) return;
    const correct = opt === correctAnswer;
    setSelected(opt);
    const newStreak = correct ? streak + 1 : 0;
    setStreak(newStreak);
    if (newStreak > bestStreak) setBestStreak(newStreak);
    if (correct) setScore((s) => s + 1);
    setResults((r) => [...r, correct]);
  };

  const next = () => {
    if (qIdx + 1 >= shuffledCards.length) { setDone(true); return; }
    setSelected(null);
    setQIdx((i) => i + 1);
  };

  const restart = (newDiff?: QuizDifficulty) => {
    setQIdx(0); setSelected(null); setScore(0); setStreak(0);
    setBestStreak(0); setDone(false); setResults([]);
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
    return (
      <div className="max-w-lg mx-auto text-center py-8">
        <Trophy className="h-10 w-10 mx-auto mb-4" style={{ color: "var(--primary)" }} />
        <h3 className="font-serif text-3xl mb-2">Quick Quiz</h3>
        <p className="text-sm mb-10" style={{ color: "var(--muted-foreground)" }}>
          {cards.length} questions · Pick your difficulty
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            { d: "easy" as QuizDifficulty,   emoji: "🟢", label: "Easy",   desc: "Pick the right answer from clearly different choices." },
            { d: "medium" as QuizDifficulty, emoji: "🟡", label: "Medium", desc: "Choices are from the same section — read carefully." },
            { d: "hard" as QuizDifficulty,   emoji: "🔴", label: "Hard",   desc: "All answers look similar. Only one is exactly right." },
          ]).map(({ d, emoji, label, desc }) => (
            <motion.button key={d} whileTap={{ scale: 0.96 }} onClick={() => setDifficulty(d)}
              className="surface rounded-2xl p-5 text-left hover:shadow-card transition group">
              <div className="text-2xl mb-3">{emoji}</div>
              <div className="font-semibold mb-1">{label}</div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  const total = shuffledCards.length;
  const pct = Math.round((score / total) * 100);

  // ── Result screen ──
  if (done) {
    const grade = pct >= 80 ? { emoji: "🏆", label: "Outstanding!", color: "var(--success)" }
      : pct >= 60 ? { emoji: "⭐", label: "Good job!", color: "var(--primary)" }
      : { emoji: "📚", label: "Keep studying!", color: "var(--warning)" };
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
        <div className="grid grid-cols-5 gap-1.5 mb-8 justify-center">
          {results.map((r, i) => (
            <div key={i} className="h-2 rounded-full" style={{ background: r ? "var(--success)" : "var(--destructive)" }} />
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={() => restart()} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition"
            style={{ background: "var(--foreground)", color: "var(--background)" }}>
            <RotateCcw className="h-4 w-4" /> Same difficulty
          </button>
          <button onClick={() => restart(difficulty === "easy" ? "medium" : difficulty === "medium" ? "hard" : "easy")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition surface">
            Try {difficulty === "hard" ? "easy" : difficulty === "medium" ? "hard" : "medium"}
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
                ⚠ All options look similar — choose precisely
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
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex items-center justify-between">
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                {selected === correctAnswer ? "✅ Correct!" : `❌ Answer: ${correctAnswer}`}
              </p>
              <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                {qIdx + 1 >= total ? "See results" : "Next"} <ArrowRight className="h-3.5 w-3.5" />
              </button>
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

function InsightsTab({ insights, concepts, onSeek }: { insights?: LectureInsights; concepts: string[]; onSeek: (s: number) => void }) {
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
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-2xl">Lecture insights.</h3>
        {insights && (
          <div className="text-xs font-mono uppercase tracking-wider flex items-center gap-3" style={{ color: "var(--muted-foreground)" }}>
            <span>{difficultyLabel}</span><span className="opacity-30">·</span>
            <span>~{insights.estimatedStudyMinutes} min to master</span>
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
        <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Tap each concept to rate your confidence — your study list updates live.</p>

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

function ChatTab({ result, materials, initialHistory, onHistoryChange }: {
  result: ProcessResult;
  materials: StudyMaterials;
  initialHistory: ChatMessage[];
  onHistoryChange: (h: ChatMessage[]) => void;
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
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: q };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context }),
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
          <div className="font-medium text-sm">Lecture Assistant</div>
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
              <div className="text-3xl mb-3">👋</div>
              <p className="text-sm font-medium mb-1">Ask me anything about this lecture</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>I&apos;ve read the full transcript and can explain any concept.</p>
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
