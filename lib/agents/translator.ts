import { invokeAgent, MODEL_NOVA_PRO } from "../bedrock";
import { StudyMaterials } from "./studyMaterialGenerator";

const SYS = `You are a professional translator. Translate only the text string values in the JSON. Keep all JSON keys, numbers, and structure exactly the same. Return ONLY valid JSON — no markdown, no code fences.`;

export async function translateMaterials(
  materials: StudyMaterials,
  targetLanguage: string
): Promise<StudyMaterials> {
  // Run all three translation calls in parallel (Haiku — fast + cheap)
  const [summariesRaw, flashcardsRaw, conceptsRaw] = await Promise.all([
    invokeAgent(SYS,
      `Translate into ${targetLanguage}:\n${JSON.stringify({ summaries: materials.summaries })}`,
      1200, MODEL_NOVA_PRO),
    invokeAgent(SYS,
      `Translate the "question" and "answer" fields only into ${targetLanguage}. Keep timestamp and sectionTitle unchanged:\n${JSON.stringify({ flashcards: materials.flashcards.slice(0, 10) })}`,
      900, MODEL_NOVA_PRO),
    invokeAgent(SYS,
      `Translate these concept phrases into ${targetLanguage}:\n${JSON.stringify({ concepts: materials.concepts })}`,
      400, MODEL_NOVA_PRO),
  ]);

  // Parse each result independently so a single failure doesn't kill everything
  let summaries = materials.summaries;
  try {
    const m = summariesRaw.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (p.summaries?.short) summaries = p.summaries;
    }
  } catch { /* keep originals */ }

  let flashcards = materials.flashcards;
  try {
    const m = flashcardsRaw.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (Array.isArray(p.flashcards) && p.flashcards.length > 0) {
        flashcards = p.flashcards.map((f: typeof flashcards[0], i: number) => ({
          ...materials.flashcards[i],
          question: f.question ?? materials.flashcards[i]?.question,
          answer:   f.answer   ?? materials.flashcards[i]?.answer,
        }));
      }
    }
  } catch { /* keep originals */ }

  let concepts = materials.concepts;
  try {
    const m = conceptsRaw.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      if (Array.isArray(p.concepts) && p.concepts.length > 0) concepts = p.concepts;
    }
  } catch { /* keep originals */ }

  return { summaries, flashcards, concepts };
}
