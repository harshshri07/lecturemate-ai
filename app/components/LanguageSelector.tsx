"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Loader2, CheckCircle } from "lucide-react";
import { StudyMaterials } from "@/lib/agents/studyMaterialGenerator";

interface LanguageSelectorProps {
  materials: StudyMaterials;
  onTranslated: (translated: StudyMaterials, language: string) => void;
}

const LANGUAGES = [
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇺🇸" },
];

export default function LanguageSelector({ materials, onTranslated }: LanguageSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);

  const translate = async (langCode: string, langLabel: string) => {
    if (loading) return;
    setSelected(langCode);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materials, targetLanguage: langLabel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Translation failed.");
        setSelected(null);
      } else {
        setTranslated(langLabel);
        onTranslated(data, langLabel);
      }
    } catch {
      setError("Network error during translation.");
      setSelected(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
        <Globe className="w-5 h-5 text-indigo-500" /> Translate Materials
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Agent 4 will translate all summaries, flashcards, and concepts into your chosen language.
      </p>

      {translated && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 mb-4"
          >
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-700 dark:text-green-300 font-medium">
              Materials translated to {translated}
            </p>
          </motion.div>
        </AnimatePresence>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {LANGUAGES.map((lang) => {
          const isActive = selected === lang.code;
          return (
            <button
              key={lang.code}
              onClick={() => translate(lang.code, lang.label)}
              disabled={loading}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all duration-200 text-center ${
                isActive && loading
                  ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30"
                  : translated && selected === lang.code
                  ? "border-green-400 bg-green-50 dark:bg-green-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate w-full text-center">
                {lang.label}
              </span>
              {isActive && loading && (
                <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
