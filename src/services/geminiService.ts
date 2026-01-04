import { GoogleGenAI, Type } from "@google/genai";
import { UILanguage, UsageStats, BookStrategy } from "../design";
import { getSystemInstruction, getAnalysisPrompt } from "../prompts";

export class GeminiTranslator {
  private modelName: string;
  private temperature: number;
  private sourceLanguage: string;
  private targetLanguage: string;
  private cachePrefix = 'lit-v15-';
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
    return (window as any).manualApiKey || process.env.API_KEY || "";
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
   * Çevirinin doğruluğunu ve eksik kalıp kalmadığını kontrol eder.
   */
  private isTranslationSuspicious(original: string, translated: string): boolean {
    const cleanOrig = original.replace(/<[^>]*>/g, '').trim();
    const cleanTrans = translated.replace(/<[^>]*>/g, '').trim();
    
    // 1. Boş sonuç kontrolü
    if (!cleanTrans || cleanTrans.length === 0) return true;

    // 2. Çok kısa sonuç kontrolü (Eğer orijinal metin uzunsa)
    if (cleanOrig.length > 50 && cleanTrans.length < 5) return true;

    // 3. Hiç değişmeyen metin kontrolü
    if (cleanOrig.length > 10 && cleanOrig === cleanTrans) return true;
    
    // 4. Dil bazlı kontrol (Hedef Türkçe ise İngilizce belirteçleri ara)
    if (this.targetLanguage.toLowerCase().includes('turkish')) {
        const englishMarkers = [' the ', ' and ', ' with ', ' that ', ' which '];
        const foundMarkers = englishMarkers.filter(m => cleanTrans.toLowerCase().includes(m));
        // Eğer uzun bir paragrafta hala çok fazla İngilizce bağlaç varsa şüphelidir
        if (foundMarkers.length > 3 && cleanOrig.length > 100) return true;
    }

    return false;
  }

  async analyzeBook(metadata: any, coverInfo?: { data: string, mimeType: string }, uiLang: UILanguage = 'en', feedback?: string): Promise<BookStrategy> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("API_KEY_MISSING");

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

      return JSON.parse(response.text || '{}');
    } catch (err: any) {
      if (err.message?.includes('429')) {
        throw new Error("QUOTA_EXHAUSTED_DURING_ANALYSIS");
      }
      console.warn("Analysis failed, using fallback.", err);
      // Fallback Strategy
      return { 
        genre_en: "Literature", tone_en: "Narrative", author_style_en: "Fluid", strategy_en: "Fidelity",
        genre_translated: "Literature", 
        tone_translated: "Narrative", 
        author_style_translated: "Fluid", 
        strategy_translated: "Fidelity",
        literary_fidelity_note: "Default fallback strategy used due to model limitations or error.", detected_creativity_level: 0.4
      };
    }
  }

  async translateSingle(htmlSnippet: string, isRetry: boolean = false): Promise<string> {
    const trimmed = htmlSnippet.trim();
    if (!trimmed) return htmlSnippet;
    
    const cacheKey = this.cachePrefix + btoa(encodeURIComponent(trimmed)).substring(0, 32) + (isRetry ? '_repair' : '');
    if (!isRetry) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("API_KEY_MISSING");

    const ai = new GoogleGenAI({ apiKey });
    
    try {
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: trimmed,
        config: { 
          systemInstruction: getSystemInstruction(this.sourceLanguage, this.targetLanguage, this.bookStrategy, isRetry), 
          temperature: isRetry ? 0.1 : this.temperature
        }
      });

      if (response.usageMetadata) {
        this.usage.promptTokens += response.usageMetadata.promptTokenCount || 0;
        this.usage.candidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
        this.usage.totalTokens += response.usageMetadata.totalTokenCount || 0;
      }

      let translated = (response.text || "").trim();
      
      // Markdown bloklarını temizle
      translated = translated.replace(/^```(html|xhtml|xml)?\n?/i, '').replace(/\n?```$/i, '').trim();

      // BOŞ ÇEVİRİ ÖNLEME: Eğer sonuç boşsa veya şüpheliyse hata fırlat
      if (this.isTranslationSuspicious(trimmed, translated)) {
          if (!isRetry) {
              throw new Error("TRANSLATION_SKIPPED_OR_INVALID");
          } else {
              // İkinci denemede de başarısızsa orijinali dönmek yerine hata ver ki sistem dursun veya kullanıcıyı uyarsın
              throw new Error("HARD_TRANSLATION_FAILURE");
          }
      }

      if (translated && translated !== trimmed) {
        try { localStorage.setItem(cacheKey, translated); } catch (e) {}
      }
      
      return translated;
    } catch (error: any) {
      if (error.message?.includes('429')) {
        throw new Error("API_QUOTA_EXCEEDED");
      }
      throw error;
    }
  }
}