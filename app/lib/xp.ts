/**
 * app/lib/xp.ts
 * XP / gamification system — Scholar Levels, Daily Quests, XP storage.
 * All data lives in localStorage so it works for both guests and signed-in users.
 */

export const XP_REWARDS = {
  exploreChapter:   10,
  reviewFlashcard:   5,
  useChat:          15,
  useSearch:        10,
  completeQuiz:     20,
  score80Plus:      50,
  checkIn:          25,
} as const;

export type XPEvent = keyof typeof XP_REWARDS;

// ── Level thresholds ─────────────────────────────────────────────────────────
// XP needed to reach each level (level 1 = 0 XP)
const LEVEL_XP = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];

export function getLevelInfo(totalXp: number): {
  level: number;
  currentXP: number;    // XP within this level
  nextLevelXP: number;  // XP needed to reach next level
  progress: number;     // 0–1
} {
  let level = 1;
  for (let i = LEVEL_XP.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_XP[i]) { level = i + 1; break; }
  }
  const start    = LEVEL_XP[level - 1] ?? 0;
  const end      = LEVEL_XP[level] ?? LEVEL_XP[LEVEL_XP.length - 1] + 1000;
  const currentXP    = totalXp - start;
  const nextLevelXP  = end - start;
  return { level, currentXP, nextLevelXP, progress: Math.min(1, currentXP / nextLevelXP) };
}

// ── Daily quests ─────────────────────────────────────────────────────────────

export interface DailyQuest {
  id:        string;
  title:     string;
  target:    number;
  reward:    number;
  progress:  number;
  completed: boolean;
}

const QUEST_DEFINITIONS: Omit<DailyQuest, "progress" | "completed">[] = [
  { id: "explore3",  title: "Explore 3 chapters",    target: 3,  reward: 30 },
  { id: "flash5",    title: "Review 5 flashcards",   target: 5,  reward: 25 },
  { id: "chat1",     title: "Ask Lecturemate anything",  target: 1,  reward: 15 },
  { id: "quiz80",    title: "Score 80%+ on the quiz", target: 1, reward: 50 },
];

// ── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "lecturemate_xp_v1";

export interface XPState {
  totalXP:    number;
  quests:     DailyQuest[];
  questDate:  string;   // "YYYY-MM-DD" — resets quests when date changes
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function freshQuests(): DailyQuest[] {
  return QUEST_DEFINITIONS.map((q) => ({ ...q, progress: 0, completed: false }));
}

export function loadXPState(): XPState {
  if (typeof window === "undefined") {
    return { totalXP: 0, quests: freshQuests(), questDate: todayStr() };
  }
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("studyai_xp_v1");
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy);
        raw = legacy;
      }
    }
    if (!raw) return { totalXP: 0, quests: freshQuests(), questDate: todayStr() };
    const parsed = JSON.parse(raw) as XPState;
    // Reset quests if it's a new day
    if (parsed.questDate !== todayStr()) {
      return { ...parsed, quests: freshQuests(), questDate: todayStr() };
    }
    return parsed;
  } catch {
    return { totalXP: 0, quests: freshQuests(), questDate: todayStr() };
  }
}

export function saveXPState(state: XPState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Award XP ─────────────────────────────────────────────────────────────────
// Returns { newState, xpGained, questCompleted? }

export function awardXP(
  state: XPState,
  event: XPEvent,
  meta?: { quizScore?: number }
): { newState: XPState; xpGained: number; questId?: string } {
  // Don't award XP for quiz events that don't meet threshold
  if (event === "score80Plus" && (meta?.quizScore ?? 0) < 80) {
    return { newState: state, xpGained: 0 };
  }

  const baseXP = XP_REWARDS[event];
  let questId: string | undefined;

  const newQuests = state.quests.map((q) => {
    if (q.completed) return q;
    let hit = false;
    if (event === "exploreChapter" && q.id === "explore3") hit = true;
    if (event === "reviewFlashcard" && q.id === "flash5")  hit = true;
    if (event === "useChat"         && q.id === "chat1")   hit = true;
    if (event === "score80Plus"     && q.id === "quiz80")  hit = true;
    if (!hit) return q;

    const newProgress = Math.min(q.target, q.progress + 1);
    const nowComplete = newProgress >= q.target && !q.completed;
    if (nowComplete) questId = q.id;
    return { ...q, progress: newProgress, completed: newProgress >= q.target };
  });

  const newState: XPState = {
    ...state,
    totalXP:  state.totalXP + baseXP,
    quests:   newQuests,
    questDate: todayStr(),
  };
  saveXPState(newState);
  return { newState, xpGained: baseXP, questId };
}
