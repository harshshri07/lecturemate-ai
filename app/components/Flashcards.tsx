"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, RotateCcw } from "lucide-react";
import { Flashcard, sortFlashcardsChronologically } from "@/lib/agents/studyMaterialGenerator";

interface FlashcardsProps {
  flashcards: Flashcard[];
  onSeek: (timestamp: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Deck order follows the lecture timeline (matches video seek timestamps). */

export default function Flashcards({ flashcards, onSeek }: FlashcardsProps) {
  const orderedCards = sortFlashcardsChronologically(flashcards);
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState(0);

  if (orderedCards.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        <p className="text-4xl mb-2">🃏</p>
        <p>No flashcards available</p>
      </div>
    );
  }

  const card = orderedCards[current];

  const goTo = (next: number) => {
    setDirection(next > current ? 1 : -1);
    setFlipped(false);
    setTimeout(() => setCurrent(next), 50);
  };

  const prev = () => current > 0 && goTo(current - 1);
  const next = () => current < orderedCards.length - 1 && goTo(current + 1);

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="text-xl">🃏</span> Flashcards
        <span className="ml-auto text-sm font-normal text-gray-400">{current + 1} / {orderedCards.length}</span>
      </h2>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 mb-5">
        <motion.div
          className="bg-indigo-500 h-1.5 rounded-full"
          animate={{ width: `${((current + 1) / orderedCards.length) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={current}
          custom={direction}
          initial={{ x: direction * 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -direction * 60, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="perspective-1000"
        >
          {/* Card flip container */}
          <div
            className="relative cursor-pointer select-none"
            style={{ height: "220px" }}
            onClick={() => setFlipped(!flipped)}
          >
            <motion.div
              className="absolute inset-0 w-full h-full"
              style={{ transformStyle: "preserve-3d" }}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 300, damping: 30 }}
            >
              {/* Front */}
              <div
                className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-6 flex flex-col justify-between shadow-xl"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Question</span>
                  <span className="text-xs text-indigo-200 bg-white/20 px-2 py-0.5 rounded-full">{card.sectionTitle}</span>
                </div>
                <p className="text-white text-lg font-semibold text-center leading-snug">{card.question}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-indigo-200">Tap to reveal answer</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSeek(card.timestamp); }}
                    className="flex items-center gap-1 text-xs text-indigo-200 hover:text-white bg-white/20 hover:bg-white/30 px-2 py-1 rounded-lg transition-colors"
                  >
                    <Clock className="w-3 h-3" />
                    {formatTime(card.timestamp)}
                  </button>
                </div>
              </div>

              {/* Back */}
              <div
                className="absolute inset-0 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-6 flex flex-col justify-between shadow-xl"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Answer</span>
                  <RotateCcw className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-gray-800 dark:text-gray-100 text-sm leading-relaxed text-center">{card.answer}</p>
                <div className="flex items-center justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSeek(card.timestamp); }}
                    className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors"
                  >
                    <Clock className="w-3 h-3" />
                    Jump to {formatTime(card.timestamp)}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between mt-5">
        <button
          onClick={prev}
          disabled={current === 0}
          className="flex items-center gap-1 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>

        <div className="flex gap-1">
          {orderedCards.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                i === current ? "bg-indigo-500 w-6" : "bg-gray-300 dark:bg-gray-600"
              }`}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={current === orderedCards.length - 1}
          className="flex items-center gap-1 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
