"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Circle, Loader2 } from "lucide-react";

export type PipelineStage =
  | "idle"
  | "extracting"
  | "structuring"
  | "generating"
  | "complete"
  | "error";

interface ProcessingStateProps {
  stage: PipelineStage;
  error?: string;
}

const STAGES = [
  { id: "extracting", label: "Extracting Transcript", description: "Fetching captions from YouTube" },
  { id: "structuring", label: "Structuring Outline", description: "Agent 1 segmenting topics" },
  { id: "generating", label: "Generating Study Materials", description: "Agent 2 creating flashcards & summaries" },
  { id: "complete", label: "Ready", description: "Your study dashboard is live" },
];

function getStageIndex(stage: PipelineStage): number {
  const map: Record<string, number> = { extracting: 0, structuring: 1, generating: 2, complete: 3 };
  return map[stage] ?? -1;
}

export default function ProcessingState({ stage, error }: ProcessingStateProps) {
  if (stage === "idle") return null;

  const currentIndex = getStageIndex(stage);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl mx-auto"
      >
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-xl">
          <div className="text-center mb-8">
            <motion.div
              animate={stage !== "complete" && stage !== "error" ? { rotate: 360 } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="inline-block"
            >
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${
                stage === "error" ? "bg-red-100 dark:bg-red-900/30" : "bg-indigo-100 dark:bg-indigo-900/30"
              }`}>
                {stage === "error" ? (
                  <span className="text-2xl">⚠️</span>
                ) : stage === "complete" ? (
                  <span className="text-2xl">✓</span>
                ) : (
                  <Loader2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
                )}
              </div>
            </motion.div>

            {stage === "error" ? (
              <>
                <h3 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Processing Failed</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
              </>
            ) : (
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {stage === "complete" ? "Analysis Complete!" : "Analyzing Your Lecture..."}
              </h3>
            )}
          </div>

          {stage !== "error" && (
            <div className="space-y-4">
              {STAGES.map((s, i) => {
                const isDone = i < currentIndex || stage === "complete";
                const isActive = i === currentIndex && stage !== "complete";
                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-300 ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700"
                        : isDone
                        ? "bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800"
                        : "bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700"
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {isDone ? (
                        <CheckCircle className="w-6 h-6 text-green-500" />
                      ) : isActive ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <Loader2 className="w-6 h-6 text-indigo-500" />
                        </motion.div>
                      ) : (
                        <Circle className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                      )}
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${
                        isActive ? "text-indigo-700 dark:text-indigo-300"
                          : isDone ? "text-green-700 dark:text-green-400"
                          : "text-gray-400 dark:text-gray-500"
                      }`}>{s.label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.description}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
