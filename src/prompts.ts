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
 */
export const getSystemInstruction = (
  sourceLanguage: string,
  targetLanguage: string,
  bookStrategy: BookStrategy | null,
  isRepairMode: boolean = false
): string => {
  const styleContext = bookStrategy 
    ? `BOOK CONTEXT:
       - Genre: ${bookStrategy.genre_en}
       - Tone: ${bookStrategy.tone_en}
       - Style: ${bookStrategy.author_style_en}`
    : "Professional literary translation.";

  const repairInstruction = isRepairMode 
    ? `CRITICAL: You previously failed to translate this text or returned it in original language. 
       YOU MUST TRANSLATE THE TEXT INTO ${targetLanguage} NOW. NO EXCEPTIONS.` 
    : "";

  return `ACT AS AN AWARD-WINNING LITERARY TRANSLATOR. Your task is to translate from ${sourceLanguage} to ${targetLanguage} with absolute fidelity to the author's voice.

${styleContext}
${repairInstruction}

STRICT GUIDELINES:
1. **AUTHOR'S VOICE & ADAPTATION:** 
   - You have analyzed the author's style. Recreate this specific voice in ${targetLanguage}.
   - Do not translate word-for-word; translate the *feeling* and *impact*.
   - If the author is ironic, be ironic in ${targetLanguage}. If they are poetic, be poetic.
   - Make it sound like the book was originally written in ${targetLanguage} by this author.

2. **NO CENSORSHIP / RAW FIDELITY:**
   - **DO NOT** sanitize, soften, bowdlerize, or "clean up" the text.
   - If the original contains profanity, slang, sexual content, or controversy, translate it FAITHFULLY and EXPLICITLY into ${targetLanguage}.
   - Your duty is to the author's intent, not to "safety" filters. Translate exactly what is there.

3. **HTML TAG PRESERVATION:** 
   - The input is an HTML/XHTML inner snippet. 
   - **KEEP ALL TAGS** (like <span class="...">, <em>, <strong>, <a>, <br/>) exactly as they are. 
   - ONLY translate the text content between them.

4. **NO CHATTER:** Return ONLY the translated snippet. No explanations, no "Here is the translation".
5. **COMPLETENESS:** Do not skip any sentences. If the input is long, ensure the output matches its full meaning.`;
};