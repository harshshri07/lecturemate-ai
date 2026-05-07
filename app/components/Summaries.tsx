"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StudyMaterials } from "@/lib/agents/studyMaterialGenerator";

interface SummariesProps {
  materials: StudyMaterials;
}

type Tab = "short" | "medium" | "full";

const TABS: { id: Tab; label: string; icon: string; description: string }[] = [
  { id: "short", label: "90-Second", icon: "⚡", description: "Quick overview" },
  { id: "medium", label: "5-Minute", icon: "📖", description: "Key points" },
  { id: "full", label: "Deep Dive", icon: "🔬", description: "Complete analysis" },
];

export default function Summaries({ materials }: SummariesProps) {
  const [activeTab, setActiveTab] = useState<Tab>("short");

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="text-xl">📝</span> Summaries
      </h2>

      <div className="flex gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/40"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.icon}</span>
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute inset-0 rounded-xl bg-indigo-600 -z-10"
              />
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-5"
        >
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
            <span className="text-lg">{TABS.find((t) => t.id === activeTab)?.icon}</span>
            <div>
              <p className="font-semibold text-sm text-gray-900 dark:text-white">
                {TABS.find((t) => t.id === activeTab)?.label} Summary
              </p>
              <p className="text-xs text-gray-400">{TABS.find((t) => t.id === activeTab)?.description}</p>
            </div>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {materials.summaries[activeTab].split("\n").map((para, i) => (
              para.trim() && (
                <p key={i} className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3 last:mb-0">
                  {para}
                </p>
              )
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {materials.concepts.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Key Concepts</p>
          <div className="flex flex-wrap gap-2">
            {materials.concepts.map((concept, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-medium border border-indigo-100 dark:border-indigo-800"
              >
                {concept}
              </motion.span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
