import { BookStrategy } from "./design";

/**
 * Kitap analizi için kullanılan ana komut.
 */
export const getAnalysisPrompt = (
  sourceLanguage: string,
  targetLanguage: string,
  metadata: any,
  uiLang: string,
  feedback?: string
): string => {
  // Flash Lite gibi modeller için daha belirgin ve basit JSON talimatı
  let prompt = `You are a literary analyst. Analyze this book metadata to guide a translator from ${sourceLanguage} to ${targetLanguage}.
    
    METADATA:
    Title: ${metadata.title}
    Author: ${metadata.creator}
    Description: ${metadata.description}

    TASK:
    1. Identify the Genre (e.g. Sci-Fi, Romance).
    2. Identify the Tone (e.g. Humorous, Dark).
    3. Identify the Writing Style (e.g. Concise, Flowery).
    4. Define a Translation Strategy.
    5. Determine a Creativity Level (0.0 to 1.0).

    OUTPUT FORMAT:
    Return ONLY a valid JSON object. Do not use Markdown code blocks. Keys must be exactly as below:
    {
      "genre_en": "String (English)",
      "tone_en": "String (English)",
      "author_style_en": "String (English)",
      "strategy_en": "String (English)",
      "genre_translated": "String (Target Language)",
      "tone_translated": "String (Target Language)",
      "author_style_translated": "String (Target Language)",
      "strategy_translated": "String (Target Language)",
      "literary_fidelity_note": "String",
      "detected_creativity_level": Number
    }`;

  if (feedback) {
    prompt += `\n\nUSER FEEDBACK (CRITICAL): The user reviewed the previous analysis and provided this correction/guidance: "${feedback}". 
    ADJUST the genre, tone, and strategy based on this feedback.`;
  }
    
  prompt += `\n\nEnsure all "translated" fields are in the interface language: ${uiLang}.`;
  
  return prompt;
};

/**
 * Metin çevirisi için kullanılan sistem talimatı.
 * repairLevel: 0 (Normal), 1 (Repair/Strict), 2 (Literal/Emergency)
 */
export const getSystemInstruction = (
  sourceLanguage: string,
  targetLanguage: string,
  bookStrategy: BookStrategy | null,
  repairLevel: number = 0
): string => {
  const styleContext = bookStrategy 
    ? `BOOK CONTEXT:
       - Genre: ${bookStrategy.genre_en}
       - Tone: ${bookStrategy.tone_en}
       - Style: ${bookStrategy.author_style_en}`
    : "Professional literary translation.";

  let modeInstruction = "";

  if (repairLevel === 0) {
      // NORMAL MODE
      modeInstruction = `1. **AUTHOR'S VOICE:** Recreate the specific voice analyzed above. Be faithful to the *effect* and *impact*.`;
  } else if (repairLevel === 1) {
      // REPAIR MODE (Strict)
      modeInstruction = `1. **CORRECTION MODE (Force Translation):** 
      - The previous output was rejected because it was untranslated or empty.
      - **YOU MUST TRANSLATE** the text into ${targetLanguage}.
      - Do not just copy the source text.`;
  } else {
      // LITERAL MODE (Emergency)
      modeInstruction = `1. **LITERAL EMERGENCY MODE:** 
      - Forget style. The previous translation failed. 
      - TRANSLATE WORD-FOR-WORD. 
      - **ABSOLUTELY NO** repetitions or English output.
      - If the text is a proper noun, transliterate it if necessary, but prefer translation.`;
  }

  return `ACT AS AN EXPERT TRANSLATOR (${sourceLanguage} -> ${targetLanguage}).
${styleContext}

YOUR MISSION:
${modeInstruction}

2. **NO CENSORSHIP / RAW FIDELITY:**
   - Do not sanitize profanity or controversial content. Translate faithfully.

3. **TECHNICAL & STRUCTURAL INTEGRITY (CRITICAL):**
   - **LaTeX & Formulas:** PRESERVE all LaTeX ($...$), formulas, and variables exactly.
   - **Code:** PRESERVE programming keywords, variables, and code blocks in ${sourceLanguage}. Translate ONLY comments/instructions.
   - **HTML Tags:** PRESERVE ALL TAGS (e.g. <span class="calibre1">). Only translate the text *inside* them.

4. **SPECIAL SECTIONS (TOC & BIBLIOGRAPHY):**
   - **Table of Contents (TOC):** Translate descriptions (e.g., "Chapter 1", "Introduction") but KEEP numbers and formatting intact.
   - **Bibliography/References:** 
     - KEEP Author names, Titles (if standard to keep them), and Years intact.
     - TRANSLATE descriptive terms like "edited by", "vol.", "retrieved from", "page".
   - **Footnotes:** Translate the explanation text but KEEP the reference numbers/markers (e.g., [1], *, †) exactly as is.

5. **ABSOLUTE PRESERVATION RULES (DO NOT TRANSLATE):**
   - **LINKS (<a> tags):** DO NOT TRANSLATE the 'href' attribute. You MAY translate the link text if it is descriptive.
   - **TABLES (<table>):** DO NOT TRANSLATE any content within table cells (<td>, <th>). Return the whole <table> block unchanged.
   - **IMAGES & GRAPHICS:** DO NOT TRANSLATE <img> alt text, <svg> content, or <figure> captions/content. Keep them 100% original.

6. **VERIFICATION RULE:**
   - **NEVER** return the input text exactly as is. You must translate it.
   - Return ONLY the translated string. No intro/outro.`;
};
