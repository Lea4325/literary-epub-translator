import { GoogleGenAI, Type } from "@google/genai";
import { UILanguage, UsageStats, BookStrategy, STORAGE_KEY_API } from "../design";
import { getSystemInstruction, getAnalysisPrompt } from "../prompts";

export class GeminiTranslator {
  private modelName: string;
  private temperature: number;
  private sourceLanguage: string;
  private targetLanguage: string;
  private cachePrefix = 'lit-v19-'; // Cache version bumped
  private bookStrategy: BookStrategy | null = null;
  private usage: UsageStats = {
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0
  };

  constructor(
    temperature: number = 0.3, 
    sourceLanguage: string = 'Auto', 
    targetLanguage: string = 'Turkish',
    modelId: string = 'gemini-flash-lite-latest'
  ) {
    this.temperature = temperature;
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    this.modelName = modelId;
  }

  private getApiKey(): string {
    if ((window as any).manualApiKey) return (window as any).manualApiKey;
    const stored = localStorage.getItem(STORAGE_KEY_API);
    if (stored) return stored;
    try {
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            // @ts-ignore
            return process.env.API_KEY;
        }
    } catch (e) {}
    try {
        // @ts-ignore
        if (import.meta && import.meta.env && import.meta.env.VITE_API_KEY) {
            // @ts-ignore
            return import.meta.env.VITE_API_KEY;
        }
    } catch (e) {}
    return "AI_BROWSER_PLACEHOLDER_KEY";
  }

  setStrategy(strategy: BookStrategy) {
    this.bookStrategy = strategy;
    if (strategy.detected_creativity_level !== undefined) {
      this.temperature = strategy.detected_creativity_level;
    }
  }

  getUsage(): UsageStats {
    return { ...this.usage };
  }

  /**
   * Çevirinin kalitesini ve geçerliliğini kontrol eden gelişmiş algoritma.
   */
  private isTranslationSuspicious(original: string, translated: string): { suspicious: boolean, reason?: string } {
    // 1. Tag Temizliği yapmadan önce "Korunması Gereken" blokları metinden çıkar.
    let validationTrans = translated
        .replace(/<table[\s\S]*?<\/table>/gi, '') 
        .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '') 
        .replace(/<img[^>]*>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<figure[\s\S]*?<\/figure>/gi, '');

    const cleanOrig = original.replace(/<[^>]*>/g, ' ').trim();
    const cleanTrans = validationTrans.replace(/<[^>]*>/g, ' ').trim();
    
    const origWithoutProtected = original
        .replace(/<table[\s\S]*?<\/table>/gi, '')
        .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '')
        .replace(/<img[^>]*>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<figure[\s\S]*?<\/figure>/gi, '')
        .replace(/<[^>]*>/g, ' ').trim();

    // 1. Boş Çıktı Kontrolü
    if (origWithoutProtected.length > 5 && (!cleanTrans || cleanTrans.length === 0)) {
         if (/^\d+$/.test(origWithoutProtected)) return { suspicious: false };
         return { suspicious: true, reason: "EMPTY_OUTPUT_AFTER_PROTECTION" };
    }
    
    // 2. Hallüsinasyon / Aşırı Kısalma Kontrolü
    if (origWithoutProtected.length > 50 && cleanTrans.length < (origWithoutProtected.length * 0.1)) {
        return { suspicious: true, reason: "TOO_SHORT" };
    }

    // --- TOC ve KAYNAKÇA TESPİTİ ---
    // Eğer metin kaynakça veya içindekiler tablosu gibi görünüyorsa doğrulama kurallarını gevşet.
    const isReferenceOrTOC = 
        // Yıl deseni (1999) veya [1]
        /\(\d{4}\)/.test(cleanOrig) || /\[\d+\]/.test(cleanOrig) ||
        // Sadece rakamla başlayıp kısa devam eden (TOC maddesi: 1. Introduction)
        /^\d+\.?\s+[A-Z]/.test(cleanOrig) ||
        // Kelimelerin çoğu büyük harfle başlıyorsa (Özel isim/Başlık yoğunluğu)
        (cleanOrig.split(' ').filter(w => /^[A-Z]/.test(w)).length / cleanOrig.split(' ').length > 0.6);

    // 3. Verbatim (Birebir) Kopyalama Kontrolü
    // Kaynakça veya TOC değilse ve metin uzunsa kontrol et.
    if (!isReferenceOrTOC && origWithoutProtected.length > 30 && origWithoutProtected.toLowerCase() === cleanTrans.toLowerCase()) {
         return { suspicious: true, reason: "VERBATIM_COPY" };
    }

    // 4. Tekrar Döngüsü Kontrolü (Looping)
    // Sadece "ve ve ve" gibi anlamsız tekrarları yakala.
    const words = cleanTrans.split(/\s+/);
    if (words.length > 15) {
        const repeatPattern = /(.{4,})\1\1/;
        if (repeatPattern.test(cleanTrans)) return { suspicious: true, reason: "REPETITIVE_LOOP" };
    }

    // 5. Kaynak Dil Kalıntısı (Sadece Hedef Türkçe ise ve Ref/TOC değilse)
    if (!isReferenceOrTOC && this.targetLanguage.toLowerCase().includes('turkish')) {
        const englishMarkers = [' the ', ' and ', ' with ', ' that ', ' which ', ' however ', ' although '];
        const lowerTrans = cleanTrans.toLowerCase();
        let markerCount = 0;
        englishMarkers.forEach(m => { if (lowerTrans.includes(m)) markerCount++; });
        
        if (markerCount > 3 && origWithoutProtected.length > 80) return { suspicious: true, reason: "SOURCE_LANGUAGE_LEAK" };
    }

    return { suspicious: false };
  }

  /**
   * Bu düğüm çeviriye gitmeli mi?
   */
  private shouldSkipTranslation(snippet: string): boolean {
      const s = snippet.trim();
      // Sadece korunan etiketlerden oluşuyorsa atla
      if (/^<img[^>]*>$/.test(s)) return true;
      // Tabloyu tamamen atla
      if (/^<table[\s\S]*?<\/table>$/.test(s)) return true;
      if (/^<svg[\s\S]*?<\/svg>$/.test(s)) return true;
      if (!s.replace(/&nbsp;/g, '').trim()) return true;
      
      // NOT: TOC linkleri (<a>...</a>) artık tamamen atlanmıyor, 
      // çünkü TOC maddelerini (Chapter 1 -> Bölüm 1) çevirmek istiyoruz.
      // Ancak "sadece link ve sadece sayı" ise atlayabiliriz.
      if (/^<a\b[^>]*>\d+<\/a>$/.test(s)) return true;

      return false;
  }

  async analyzeBook(metadata: any, coverInfo?: { data: string, mimeType: string }, uiLang: UILanguage = 'en', feedback?: string): Promise<BookStrategy> {
    const apiKey = this.getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const prompt = getAnalysisPrompt(this.sourceLanguage, this.targetLanguage, metadata, uiLang, feedback);

    try {
      const response = await ai.models.generateContent({
        model: this.modelName, 
        contents: prompt,
        config: { 
          tools: this.modelName.includes('pro') ? [{googleSearch: {}}] : undefined,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genre_en: { type: Type.STRING },
              tone_en: { type: Type.STRING },
              author_style_en: { type: Type.STRING },
              strategy_en: { type: Type.STRING },
              genre_translated: { type: Type.STRING },
              tone_translated: { type: Type.STRING },
              author_style_translated: { type: Type.STRING },
              strategy_translated: { type: Type.STRING },
              literary_fidelity_note: { type: Type.STRING },
              detected_creativity_level: { type: Type.NUMBER }
            },
            required: ["genre_en", "tone_en", "author_style_en", "strategy_en", "genre_translated", "tone_translated", "author_style_translated", "strategy_translated", "literary_fidelity_note", "detected_creativity_level"]
          }
        }
      });

      if (response.usageMetadata) {
        this.usage.promptTokens += response.usageMetadata.promptTokenCount || 0;
        this.usage.candidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
        this.usage.totalTokens += response.usageMetadata.totalTokenCount || 0;
      }

      let jsonStr = response.text || '{}';
      jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr);
    } catch (err: any) {
      if (err.message?.includes('429')) throw new Error("QUOTA_EXHAUSTED_DURING_ANALYSIS");
      if (apiKey === "AI_BROWSER_PLACEHOLDER_KEY") throw new Error("MISSING_KEY_REDIRECT");
      
      console.warn("Analysis failed, using fallback.", err);
      return { 
        genre_en: "Literature", tone_en: "Narrative", author_style_en: "Fluid", strategy_en: "Fidelity",
        genre_translated: "Edebiyat", tone_translated: "Anlatı", author_style_translated: "Akıcı", strategy_translated: "Sadakat",
        literary_fidelity_note: "Fallback strategy.", detected_creativity_level: 0.3
      };
    }
  }

  async translateSingle(htmlSnippet: string, forceRetryMode: boolean = false): Promise<string> {
    const trimmed = htmlSnippet.trim();
    if (!trimmed) return htmlSnippet;

    if (this.shouldSkipTranslation(trimmed)) {
        return trimmed;
    }
    
    const cacheKey = this.cachePrefix + btoa(encodeURIComponent(trimmed)).substring(0, 32);
    if (!forceRetryMode) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
    }

    const apiKey = this.getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    
    let lastError: any = null;
    let attempt = 0;
    const maxRetries = 2; 

    while (attempt <= maxRetries) {
        try {
            let currentTemp = this.temperature;
            let repairLevel = 0; 

            if (forceRetryMode || attempt > 0) {
                repairLevel = attempt === 0 ? 1 : attempt; 
                currentTemp = repairLevel === 2 ? 0.0 : 0.15; 
            }

            const sysInstruction = getSystemInstruction(
                this.sourceLanguage, 
                this.targetLanguage, 
                this.bookStrategy, 
                repairLevel
            );

            const response = await ai.models.generateContent({
                model: this.modelName,
                contents: trimmed,
                config: { 
                    systemInstruction: sysInstruction, 
                    temperature: currentTemp
                }
            });

            if (response.usageMetadata) {
                this.usage.promptTokens += response.usageMetadata.promptTokenCount || 0;
                this.usage.candidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
                this.usage.totalTokens += response.usageMetadata.totalTokenCount || 0;
            }

            let translated = (response.text || "").trim();
            translated = translated.replace(/^```(html|xhtml|xml)?\n?/i, '').replace(/\n?```$/i, '').trim();

            const check = this.isTranslationSuspicious(trimmed, translated);
            if (check.suspicious) {
                console.warn(`Attempt ${attempt} failed validation: ${check.reason}`);
                throw new Error(`VALIDATION_FAILED_${check.reason}`);
            }

            if (translated && translated !== trimmed) {
                try { localStorage.setItem(cacheKey, translated); } catch (e) {}
            }
            return translated;

        } catch (error: any) {
            lastError = error;
            // Kritik hatalarda (Kota, Key) hemen çık
            if (error.message?.includes('429')) throw new Error("API_QUOTA_EXCEEDED");
            if (error.message?.includes('API key') || apiKey === "AI_BROWSER_PLACEHOLDER_KEY") throw new Error("MISSING_KEY_REDIRECT");
            
            attempt++;
            if (attempt <= maxRetries) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }
    
    // FALLBACK: Tüm denemeler başarısız olduysa, uygulamanın çökmesini engellemek için
    // orijinal metni döndür ve devam et. Bu özellikle TOC ve Kaynakça gibi 
    // AI'ın çevirmekte zorlandığı veya reddettiği kısımlarda hayati önem taşır.
    console.warn("All translation attempts failed. Using original text as fallback.", trimmed);
    return trimmed; 
  }
}
