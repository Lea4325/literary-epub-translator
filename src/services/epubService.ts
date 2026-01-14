import JSZip from 'jszip';
import { GeminiTranslator } from './geminiService';
import { UILanguage, TranslationSettings, ResumeInfo, BookStats, LogEntry, UsageStats, BookStrategy } from '../design';
import { STRINGS_LOGS } from '../lang/logs';

export interface TranslationProgress {
  currentFile: number;
  totalFiles: number;
  currentPercent: number;
  status: 'idle' | 'processing' | 'completed' | 'error' | 'analyzing' | 'resuming';
  logs: LogEntry[];
  etaSeconds?: number;
  strategy?: BookStrategy;
  usage?: UsageStats;
  wordsPerSecond?: number;
  totalProcessedWords?: number;
  lastZipPathIndex?: number;
  lastNodeIndex?: number;
  translatedNodes?: Record<string, string[]>;
  totalProcessedSentences?: number;
}

function getLogStr(uiLang: string, key: string): string {
  const bundle = STRINGS_LOGS[uiLang] || STRINGS_LOGS['en'];
  return bundle[key] || STRINGS_LOGS['en'][key];
}

/**
 * Metindeki cümle sayısını hesaplar.
 * İlerleme çubuğu için tutarlı bir metrik sağlar.
 */
export function countSentences(text: string): number {
    if (!text || !text.trim()) return 0;
    // Basit cümle sayımı: . ! ? ile bitenler veya yeni satırlar.
    // HTML taglerini temizle
    const cleanText = text.replace(/<[^>]*>/g, ' ').trim();
    if (cleanText.length === 0) return 0;
    
    const matches = cleanText.match(/[.!?]+/g);
    // Hiç noktalama yoksa ama metin varsa en az 1 cümle say.
    return matches ? matches.length : 1;
}

// İstatistik Hesaplama Fonksiyonu
export async function calculateEpubStats(file: File, targetTags: string[], hasUserKey: boolean): Promise<BookStats> {
  const epubBuffer = await file.arrayBuffer();
  const epubZip = await new JSZip().loadAsync(epubBuffer);
  const parser = new DOMParser();

  // OPF Bulma (Dosya listesi için)
  const containerXml = await epubZip.file("META-INF/container.xml")?.async("string");
  const containerDoc = parser.parseFromString(containerXml || "", "application/xml");
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path") || "";
  const opfContent = await epubZip.file(opfPath)?.async("string");
  const opfDoc = parser.parseFromString(opfContent || "", "application/xml");
  const opfFolder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  const manifestItems = Array.from(opfDoc.querySelectorAll("manifest > item"));
  const idToHref: Record<string, string> = {};
  manifestItems.forEach(item => idToHref[item.getAttribute("id") || ""] = item.getAttribute("href") || "");

  const spineItems = Array.from(opfDoc.querySelectorAll("spine > itemref"));
  
  // HTML Dosyalarını Listele
  const processList = spineItems.map(item => {
    const href = idToHref[item.getAttribute("idref") || ""];
    const path = opfFolder ? `${opfFolder}/${href}` : href;
    return decodeURIComponent(path);
  }).filter(p => epubZip.file(p));

  let totalChars = 0;
  let totalWords = 0;
  let totalSentences = 0;
  const fileSentenceCounts: number[] = [];

  // Tüm dosyaları hızlıca tara
  for (const path of processList) {
    const content = await epubZip.file(path)?.async("string");
    if (!content) {
        fileSentenceCounts.push(0);
        continue;
    }
    
    // Sadece hedef taglerin içindeki metni say
    const doc = parser.parseFromString(content, "text/html");
    const nodes = Array.from(doc.querySelectorAll(targetTags.join(',')));
    
    let fileSentences = 0;
    nodes.forEach(node => {
        const text = node.innerHTML.trim();
        if (text.length > 0) {
            const cleanText = node.textContent || "";
            totalChars += cleanText.length;
            totalWords += cleanText.split(/\s+/).length;
            
            const sCount = countSentences(text);
            fileSentences += sCount;
            totalSentences += sCount;
        }
    });
    fileSentenceCounts.push(fileSentences);
  }

  // Tahminler
  // 1 Token ~= 4 Char
  const estimatedTokens = Math.ceil(totalChars / 3.5); 
  
  // Tahmini İstek Sayısı (Chunk)
  // Gemini'ye her paragraf/node ayrı gidiyor varsayımıyla veya birleştirilmiş chunklar:
  // Ortalama chunk büyüklüğü ~500 karakter diyelim (Daha güvenli bir tahmin)
  const estimatedChunks = Math.ceil(totalChars / 500); 

  // Süre Hesaplaması
  // Free: 15 RPM
  const durationFree = Math.ceil(estimatedChunks / 15); 
  // Paid: ~30-40 RPM
  const durationPro = Math.ceil(estimatedChunks / 30); 

  return {
    totalChars,
    totalWords,
    totalSentences,
    estimatedTokens,
    estimatedChunks,
    estimatedDurationFree: Math.max(1, durationFree), 
    estimatedDurationPro: Math.max(1, durationPro),
    fileSentenceCounts // İlerleme çubuğu hassasiyeti için eklendi
  };
}

export async function analyzeEpubOnly(
  file: File,
  settings: TranslationSettings,
  feedback?: string
): Promise<BookStrategy> {
  const translator = new GeminiTranslator(settings.temperature, settings.sourceLanguage, settings.targetLanguage, settings.modelId);
  const epubBuffer = await file.arrayBuffer();
  const epubZip = await new JSZip().loadAsync(epubBuffer);
  
  const containerXml = await epubZip.file("META-INF/container.xml")?.async("string");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml || "", "application/xml");
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path") || "";
  const opfContent = await epubZip.file(opfPath)?.async("string");
  const opfDoc = parser.parseFromString(opfContent || "", "application/xml");

  const metadata = {
    title: opfDoc.querySelector("dc\\:title, title")?.textContent || "Untitled",
    creator: opfDoc.querySelector("dc\\:creator, creator")?.textContent || "Unknown",
    description: opfDoc.querySelector("dc\\:description, description")?.textContent || "",
  };

  try {
    return await translator.analyzeBook(metadata, undefined, settings.uiLang, feedback);
  } catch (err: any) {
    if (err.message === "QUOTA_EXHAUSTED_DURING_ANALYSIS") {
      throw new Error("ANALYSIS_QUOTA_ERROR");
    }
    throw err;
  }
}

export async function processEpub(
  file: File, 
  settings: TranslationSettings,
  onProgress: (progress: TranslationProgress) => void,
  signal: AbortSignal,
  resumeFrom?: ResumeInfo,
  precomputedStrategy?: BookStrategy,
  precomputedStats?: BookStats // İlerleme çubuğu için gerekli
): Promise<{ epubBlob: Blob }> {
  const ui = settings.uiLang;
  const translator = new GeminiTranslator(settings.temperature, settings.sourceLanguage, settings.targetLanguage, settings.modelId);
  const epubBuffer = await file.arrayBuffer();
  const epubZip = await new JSZip().loadAsync(epubBuffer);

  let totalWords = 0;
  let processedFilesCount = resumeFrom ? resumeFrom.zipPathIndex : 0;
  
  // Eğer resume bilgisinde kayıtlı cümle sayısı varsa onu kullan, yoksa 0'dan başla.
  // Bu, progress barın kaldığı yerden doğru şekilde devam etmesini sağlar.
  let accumulatedSentences = resumeFrom && resumeFrom.totalProcessedSentences ? resumeFrom.totalProcessedSentences : 0;
  
  let processList: string[] = [];
  const translatedNodes: Record<string, string[]> = resumeFrom ? { ...resumeFrom.translatedNodes } : {};
  let strategy: BookStrategy | undefined = precomputedStrategy;

  let cumulativeLogs: LogEntry[] = [
    { timestamp: new Date().toLocaleTimeString(), text: getLogStr(ui, 'analyzing'), type: 'info' }
  ];

  // Toplam cümle sayısı bilgisi varsa progress bar daha hassas çalışır.
  const totalBookSentences = precomputedStats?.totalSentences || 0;

  const triggerProgress = (updates: Partial<TranslationProgress>) => {
    // Yüzde Hesabı:
    // Eğer toplam cümle sayısı biliniyorsa: (İşlenen Cümle / Toplam Cümle) * 100
    // Bilinmiyorsa (Analiz atlandıysa): Dosya bazlı kaba tahmin.
    let percent = 0;
    
    if (totalBookSentences > 0) {
        percent = Math.min(99, Math.round((accumulatedSentences / totalBookSentences) * 100));
    } else {
        // Fallback: Dosya bazlı hesaplama (Eski yöntem)
        percent = processList.length > 0 ? Math.round((processedFilesCount / processList.length) * 100) : 0;
    }

    onProgress({
      currentFile: processedFilesCount,
      totalFiles: processList.length || 0,
      currentPercent: percent,
      status: 'processing',
      logs: [...cumulativeLogs],
      strategy,
      usage: translator.getUsage(),
      totalProcessedWords: totalWords,
      translatedNodes,
      totalProcessedSentences: accumulatedSentences,
      ...updates
    });
  };

  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    cumulativeLogs.push({ timestamp: new Date().toLocaleTimeString(), text, type });
    if (cumulativeLogs.length > 50) cumulativeLogs.shift();
    triggerProgress({});
  };

  // --- FREE TIER PACING (THROTTLING) ---
  const isFreeTier = !settings.hasPaidKey && (settings.modelId === 'gemini-flash-lite-latest' || settings.modelId === 'gemini-2.0-flash-lite-preview');
  const minInterval = isFreeTier ? 4000 : 0; 
  
  if (isFreeTier) {
      addLog(getLogStr(ui, 'freeTierActive') || "Free Tier Pacing Active (15 RPM)...", 'warning');
  }

  const containerXml = await epubZip.file("META-INF/container.xml")?.async("string");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml || "", "application/xml");
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path") || "";
  const opfContent = await epubZip.file(opfPath)?.async("string");
  const opfDoc = parser.parseFromString(opfContent || "", "application/xml");
  const opfFolder = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  if (!strategy) {
    triggerProgress({ status: 'analyzing' });
    const metadata = {
      title: opfDoc.querySelector("dc\\:title, title")?.textContent || "Untitled",
      creator: opfDoc.querySelector("dc\\:creator, creator")?.textContent || "Unknown",
      description: opfDoc.querySelector("dc\\:description, description")?.textContent || "",
    };
    try {
      strategy = await translator.analyzeBook(metadata, undefined, ui);
    } catch (err: any) {
      if (err.message === "QUOTA_EXHAUSTED_DURING_ANALYSIS") {
        addLog(getLogStr(ui, 'noQuota'), 'error');
        throw new Error("INSUFFICIENT_TOKENS_FOR_ANALYSIS");
      }
      throw err;
    }
  } else {
    addLog(getLogStr(ui, 'preComputed'), 'success');
  }
  
  translator.setStrategy(strategy);

  const manifestItems = Array.from(opfDoc.querySelectorAll("manifest > item"));
  const idToHref: Record<string, string> = {};
  manifestItems.forEach(item => idToHref[item.getAttribute("id") || ""] = item.getAttribute("href") || "");

  const spineItems = Array.from(opfDoc.querySelectorAll("spine > itemref"));
  processList = spineItems.map(item => {
    const href = idToHref[item.getAttribute("idref") || ""];
    const path = opfFolder ? `${opfFolder}/${href}` : href;
    return decodeURIComponent(path);
  }).filter(p => epubZip.file(p)) as string[];

  addLog(getLogStr(ui, 'found').replace('{0}', processList.length.toString()), 'success');
  const startTime = Date.now();

  // --- ÇEVİRİ DÖNGÜSÜ ---
  for (let zipIdx = processedFilesCount; zipIdx < processList.length; zipIdx++) {
    const path = processList[zipIdx];
    if (signal.aborted) throw new Error("Stopped.");

    const content = await epubZip.file(path)?.async("string");
    if (!content) continue;

    const doc = parser.parseFromString(content, "text/html");
    const nodes = Array.from(doc.querySelectorAll(settings.targetTags.join(',')));

    if (nodes.length > 0) {
      addLog(getLogStr(ui, 'processingFile').replace('{0}', path.split('/').pop() || ""), 'info');
      if (!translatedNodes[path]) translatedNodes[path] = [];
      const startNodeIdx = (resumeFrom && zipIdx === resumeFrom.zipPathIndex) ? resumeFrom.nodeIndex : 0;

      for (let nodeIdx = startNodeIdx; nodeIdx < nodes.length; nodeIdx++) {
        if (signal.aborted) throw new Error("Stopped.");
        
        const stepStart = Date.now(); 
        
        const node = nodes[nodeIdx];
        const original = node.innerHTML.trim();
        if (!original) continue;

        // Cümle sayısını al (İlerleme çubuğu için)
        const nodeSentences = countSentences(original);

        if (translatedNodes[path][nodeIdx]) {
          node.innerHTML = translatedNodes[path][nodeIdx];
        } else {
          try {
            const trans = await translator.translateSingle(original);
            node.innerHTML = trans;
            translatedNodes[path][nodeIdx] = trans;
            totalWords += (node.textContent || "").split(/\s+/).length;
          } catch (err: any) {
            if (err.message === "TRANSLATION_SKIPPED_OR_INVALID") {
                addLog(getLogStr(ui, 'repairing'), 'warning');
                try {
                    const repaired = await translator.translateSingle(original, true);
                    node.innerHTML = repaired;
                    translatedNodes[path][nodeIdx] = repaired;
                } catch (repairErr: any) {
                   addLog(getLogStr(ui, 'repairFailed'), 'error');
                   node.innerHTML = original;
                }
            } else if (err.message === "API_QUOTA_EXCEEDED" || err.message?.includes('429')) {
              addLog(getLogStr(ui, 'quotaExceeded'), 'warning');
              await new Promise(r => {
                const timeout = setTimeout(r, 65000);
                signal.addEventListener('abort', () => clearTimeout(timeout));
              });
              nodeIdx--; continue; 
            } else {
                console.error("Critical node translation error:", err);
                node.innerHTML = original;
            }
          }
        }
        
        // Cümle sayısını güncelle
        accumulatedSentences += nodeSentences;

        const stepEnd = Date.now();
        const elapsed = stepEnd - stepStart;

        // SMART THROTTLING
        if (isFreeTier && minInterval > 0) {
            const delay = Math.max(0, minInterval - elapsed);
            if (delay > 0) {
                 await new Promise(r => setTimeout(r, delay));
            }
        }
        
        const totalElapsed = (Date.now() - startTime) / 1000;
        
        // Kalan Süre (ETA) Hesabı
        // Artık cümle bazlı hesaplayabiliriz ki bu çok daha doğru olur.
        let eta = 0;
        if (totalBookSentences > 0 && accumulatedSentences > 10) {
            const avgTimePerSentence = totalElapsed / (accumulatedSentences - (resumeFrom?.totalProcessedSentences || 0));
            const remainingSentences = totalBookSentences - accumulatedSentences;
            eta = Math.max(0, Math.round(remainingSentences * avgTimePerSentence));
        } else {
             // Fallback ETA
             const currentProgressFrac = (zipIdx + (nodeIdx / nodes.length)) / processList.length;
             if(currentProgressFrac > 0.01) {
                const totalTime = totalElapsed / currentProgressFrac;
                eta = Math.max(0, Math.round(totalTime - totalElapsed));
             }
        }

        triggerProgress({
            wordsPerSecond: totalWords / totalElapsed,
            etaSeconds: eta,
            lastZipPathIndex: zipIdx,
            lastNodeIndex: nodeIdx
        });
      }
      
      const serializer = new XMLSerializer();
      epubZip.file(path, serializer.serializeToString(doc));
    }
    processedFilesCount++;
  }

  addLog(getLogStr(ui, 'saving'), 'info');
  const epubBlob = await epubZip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
  
  addLog(getLogStr(ui, 'finished'), 'success');
  onProgress({ currentFile: processList.length, totalFiles: processList.length, currentPercent: 100, status: 'completed', logs: [...cumulativeLogs], strategy, usage: translator.getUsage() });
  
  return { epubBlob };
}
