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
  let prompt = `Perform a deep literary and structural analysis of this book for translation from ${sourceLanguage} to ${targetLanguage}.
    
    METADATA:
    Title: ${metadata.title}
    Author: ${metadata.creator}
    Description: ${metadata.description}

    TASK:
    1. **Research & Style Analysis:** Search/Access your knowledge base regarding the author '${metadata.creator}' and their specific literary style in their native language.
    2. **Target Adaptation:** Define how this specific author's voice/style should be adapted into ${targetLanguage}. The goal is to preserve the *effect* of the original style (e.g., irony, dryness, poetic flow) while making it sound authentic to a native ${targetLanguage} reader.
    3. **Uncensored Strategy:** Ensure the strategy explicitly allows for raw, faithful, and uncensored translation if the source material contains gritty, explicit, or colloquial language. Do not sanitize the author's intent.`;

  if (feedback) {
    prompt += `\n\nUSER FEEDBACK (CRITICAL): The user reviewed the previous analysis and provided this correction/guidance: "${feedback}". 
    ADJUST the genre, tone, and strategy based on this feedback.`;
  }
    
  prompt += `\n\nReturn a JSON blueprint. All translated fields must be in the interface language: ${uiLang}.`;
  
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
      modeInstruction = `1. **CORRECTION MODE:** You previously returned empty, repetitive, or incorrect output. 
      - **DO NOT** loop or repeat words.
      - **DO NOT** return the original text.
      - Translate the meaning accurately and strictly into ${targetLanguage}.`;
  } else {
      // LITERAL MODE (Emergency)
      modeInstruction = `1. **LITERAL EMERGENCY MODE:** 
      - Forget the literary style. The previous translation failed. 
      - TRANSLATE WORD-FOR-WORD OR SENTENCE-BY-SENTENCE. 
      - Priority is conveying meaning, not style. 
      - **ABSOLUTELY NO** repetitions or English output.`;
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
     - Do not try to "localize" the citation format itself, just the connecting words.
   - **Footnotes:** Translate the explanation text but KEEP the reference numbers/markers (e.g., [1], *, †) exactly as is.

5. **ABSOLUTE PRESERVATION RULES (DO NOT TRANSLATE):**
   - **LINKS (<a> tags):** DO NOT TRANSLATE the 'href' attribute. You MAY translate the link text if it is descriptive.
   - **TABLES (<table>):** DO NOT TRANSLATE any content within table cells (<td>, <th>). Return the whole <table> block unchanged.
   - **IMAGES & GRAPHICS:** DO NOT TRANSLATE <img> alt text, <svg> content, or <figure> captions/content. Keep them 100% original.

6. **OUTPUT RULES:**
   - Return ONLY the translated string. No intro/outro.
   - Do not output "The translation is:". Just the text.
   - If the input is just a number or symbol, return it as is.
   - **NEVER** return empty text.`;
};
