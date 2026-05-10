/**
 * adaptLevel — recency-weighted skill level inference.
 *
 * Each quiz attempt is assigned a weight that decays exponentially with age
 * (most recent attempt counts most). The weighted average score is then
 * mapped to a SkillLevel threshold.
 *
 * Thresholds:
 *   score >= 75  → advanced
 *   score >= 45  → intermediate
 *   score <  45  → beginner
 */

export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface QuizHistoryEntry {
  videoId: string;
  score: number; // 0-100 percentage
  level: SkillLevel;
  timestamp?: number; // ms since epoch; optional for backward compat
}

export interface LearnerProfile {
  id: string;
  overallLevel: SkillLevel;
  quizHistory: QuizHistoryEntry[];
  chatTone: "explain-simply" | "peer-level" | "challenge-me";
  checkedInLectures: string[]; // videoIds where the check-in modal was already shown
  updatedAt?: number;
}

const LEVEL_THRESHOLDS = {
  advanced: 75,
  intermediate: 45,
} as const;

const LEARNER_PROFILE_KEY = "lecturemate_learner";

/** Map a weighted score to a SkillLevel. */
export function scoreToLevel(weightedScore: number): SkillLevel {
  if (weightedScore >= LEVEL_THRESHOLDS.advanced) return "advanced";
  if (weightedScore >= LEVEL_THRESHOLDS.intermediate) return "intermediate";
  return "beginner";
}

/** Map a SkillLevel to the corresponding chat tone. */
export function levelToTone(level: SkillLevel): LearnerProfile["chatTone"] {
  if (level === "advanced") return "challenge-me";
  if (level === "intermediate") return "peer-level";
  return "explain-simply";
}

/**
 * Given a learner profile and an optional new quiz score (0-100), compute
 * the updated SkillLevel using a recency-weighted average of all quiz scores.
 *
 * The most recent entry (index 0 after unshift) gets weight 1.0, the next
 * gets 0.5, the next 0.25, and so on (halving). Minimum weight floor is 0.05
 * so old data still contributes slightly.
 */
export function adaptLevel(
  profile: LearnerProfile,
  newScore?: number
): SkillLevel {
  const history = newScore !== undefined
    ? [{ videoId: "", score: newScore, level: "beginner" as SkillLevel }, ...profile.quizHistory]
    : profile.quizHistory;

  if (history.length === 0) return profile.overallLevel;

  let totalWeight = 0;
  let weightedSum = 0;

  history.forEach((entry, i) => {
    const weight = Math.max(Math.pow(0.5, i), 0.05);
    weightedSum += entry.score * weight;
    totalWeight += weight;
  });

  const weightedAverage = weightedSum / totalWeight;
  return scoreToLevel(weightedAverage);
}

/** Load learner profile from localStorage, or return a fresh default. */
export function loadLearnerProfile(): LearnerProfile {
  if (typeof window === "undefined") return createDefaultProfile();
  try {
    let raw = localStorage.getItem(LEARNER_PROFILE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("studyai_learner");
      if (legacy) {
        localStorage.setItem(LEARNER_PROFILE_KEY, legacy);
        raw = legacy;
      }
    }
    if (!raw) return createDefaultProfile();
    const parsed = JSON.parse(raw) as Partial<LearnerProfile>;
    return {
      ...createDefaultProfile(),
      ...parsed,
      quizHistory: Array.isArray(parsed.quizHistory) ? parsed.quizHistory : [],
      checkedInLectures: Array.isArray(parsed.checkedInLectures) ? parsed.checkedInLectures : [],
    };
  } catch {
    return createDefaultProfile();
  }
}

/** Persist learner profile to localStorage. */
export function saveLearnerProfile(profile: LearnerProfile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LEARNER_PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: Date.now() }));
  } catch { /* storage full — ignore */ }
}

function createDefaultProfile(): LearnerProfile {
  return {
    id: generateId(),
    overallLevel: "intermediate",
    quizHistory: [],
    chatTone: "peer-level",
    checkedInLectures: [],
  };
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
