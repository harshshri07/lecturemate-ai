"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Clock, Loader2, ChevronRight } from "lucide-react";
import { StructuredLecture } from "@/lib/agents/structurer";
import { SearchResult } from "@/lib/agents/semanticSearch";

interface SemanticSearchProps {
  lecture: StructuredLecture;
  onSeek: (timestamp: number) => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CONFIDENCE_COLORS = {
  high: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
  medium: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
  low: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
};

const EXAMPLE_QUESTIONS = [
  "What is the main thesis of this lecture?",
  "Can you explain the key formula introduced?",
  "What examples were used to illustrate the concept?",
];

export default function SemanticSearch({ lecture, onSeek }: SemanticSearchProps) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 3) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, lecture }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(question);
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="text-xl">🔍</span> Semantic Search
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Ask a question about this lecture — Agent 3 will find the exact moment.
      </p>

      <form onSubmit={handleSubmit} className="relative mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about this lecture..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || question.trim().length < 3}
            className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-800 text-white rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>
      </form>

      {/* Example questions */}
      {!result && !loading && (
        <div className="flex flex-wrap gap-2 mb-4">
          {EXAMPLE_QUESTIONS.map((q, i) => (
            <button
              key={i}
              onClick={() => { setQuestion(q); search(q); }}
              className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors border border-gray-200 dark:border-gray-700"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800"
          >
            <Loader2 className="w-5 h-5 text-indigo-500 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Agent 3 is searching...</p>
              <p className="text-xs text-indigo-500 dark:text-indigo-400">Analyzing transcript semantics</p>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800"
          >
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </motion.div>
        )}

        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${CONFIDENCE_COLORS[result.confidence]}`}>
                  {result.confidence} confidence
                </span>
                <span className="text-xs text-gray-400">{result.sectionTitle}</span>
              </div>
              <button
                onClick={() => onSeek(result.timestamp)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                <Clock className="w-3 h-3" />
                Jump to {formatTime(result.timestamp)}
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2 italic">"{result.excerpt}"</p>
              {result.context && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{result.context}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
