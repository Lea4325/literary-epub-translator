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
}

function getLogStr(uiLang: string, key: string): string {
  const bundle = STRINGS_LOGS[uiLang] || STRINGS_LOGS['en'];
  return bundle[key] || STRINGS_LOGS['en'][key];
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

  // Tüm dosyaları hızlıca tara
  for (const path of processList) {
    const content = await epubZip.file(path)?.async("string");
    if (!content) continue;
    
    // Sadece hedef taglerin içindeki metni say
    const doc = parser.parseFromString(content, "text/html");
    const nodes = Array.from(doc.querySelectorAll(targetTags.join(',')));
    
    nodes.forEach(node => {
        const text = node.textContent || "";
        const cleanText = text.trim();
        if (cleanText.length > 0) {
            totalChars += cleanText.length;
            totalWords += cleanText.split(/\s+/).length;
            // Basit cümle sayımı (. ! ? ile bitenler)
            const sentences = cleanText.match(/[.!?]+/g);
            totalSentences += sentences ? sentences.length : 1;
        }
    });
  }

  // Tahminler
  // 1 Token ~= 4 Char
  const estimatedTokens = Math.ceil(totalChars / 3.5); 
  
  // Tahmini İstek Sayısı (Chunk)
  // Gemini'ye her paragraf/node ayrı gidiyor varsayımıyla veya birleştirilmiş chunklar:
  // Ortalama chunk büyüklüğü ~500 karakter diyelim (Daha güvenli bir tahmin)
  const estimatedChunks = Math.ceil(totalChars / 500); 

  // Süre Hesaplaması
  
  // 1. FREE MODE (Anahtarsız):
  // Google Gemini Free Tier Limitleri: 15 RPM (Dakikada 15 istek).
  // Bu durumda her 4 saniyede 1 istek atabiliriz.
  // Ek olarak latency süresi var.
  // Süre (dk) = (Chunk Sayısı / 15)
  const durationFree = Math.ceil(estimatedChunks / 15); 
  
  // 2. PAID/KEY MODE (Anahtarlı):
  // Kişisel API Key limitleri çok daha yüksektir (örn: 2000 RPM).
  // Burada sınırlayıcı faktör ağ gecikmesi ve modelin üretim hızıdır.
  // Ortalama bir istek 1.5 - 2 saniye sürer.
  // Dakikada yaklaşık 30-40 istek işlenebilir (paralel olmasa bile).
  const durationPro = Math.ceil(estimatedChunks / 30); 

  return {
    totalChars,
    totalWords,
    totalSentences,
    estimatedTokens,
    estimatedChunks,
    // Eğer kullanıcının anahtarı yoksa (hasUserKey = false), "tahmini süre" olarak uzun olanı göster.
    // Eğer varsa kısa olanı göster. Ancak biz burada ham verileri dönüyoruz, UI karar verecek.
    estimatedDurationFree: Math.max(1, durationFree), 
    estimatedDurationPro: Math.max(1, durationPro)
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
  precomputedStrategy?: BookStrategy
): Promise<{ epubBlob: Blob }> {
  const ui = settings.uiLang;
  const translator = new GeminiTranslator(settings.temperature, settings.sourceLanguage, settings.targetLanguage, settings.modelId);
  const epubBuffer = await file.arrayBuffer();
  const epubZip = await new JSZip().loadAsync(epubBuffer);

  let totalWords = 0;
  let processedFilesCount = resumeFrom ? resumeFrom.zipPathIndex : 0;
  let processList: string[] = [];
  const translatedNodes: Record<string, string[]> = resumeFrom ? { ...resumeFrom.translatedNodes } : {};
  let strategy: BookStrategy | undefined = precomputedStrategy;

  let cumulativeLogs: LogEntry[] = [
    { timestamp: new Date().toLocaleTimeString(), text: getLogStr(ui, 'analyzing'), type: 'info' }
  ];

  const triggerProgress = (updates: Partial<TranslationProgress>) => {
    onProgress({
      currentFile: processedFilesCount,
      totalFiles: processList.length || 0,
      currentPercent: processList.length > 0 ? Math.round((processedFilesCount / processList.length) * 100) : 0,
      status: 'processing',
      logs: [...cumulativeLogs],
      strategy,
      usage: translator.getUsage(),
      totalProcessedWords: totalWords,
      translatedNodes,
      ...updates
    });
  };

  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    cumulativeLogs.push({ timestamp: new Date().toLocaleTimeString(), text, type });
    if (cumulativeLogs.length > 50) cumulativeLogs.shift();
    triggerProgress({});
  };

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
        const node = nodes[nodeIdx];
        const original = node.innerHTML.trim();
        if (!original) continue;

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
              // KOTA AŞIMI BEKLEMESİ (Rate Limit Backoff)
              // Ücretsiz modda 15 RPM = 60/15 = 4sn. Ancak güvenli olması için biraz daha uzun beklenebilir.
              // Eğer hata aldıysak, Google bizi bloklamış demektir, 60s beklemek en güvenlisidir.
              await new Promise(r => {
                const timeout = setTimeout(r, 65000);
                signal.addEventListener('abort', () => clearTimeout(timeout));
              });
              nodeIdx--; continue; // Düğümü tekrar dene
            } else {
                console.error("Critical node translation error:", err);
                node.innerHTML = original;
            }
          }
        }
        
        const elapsed = (Date.now() - startTime) / 1000;
        const currentProgressFrac = (zipIdx + (nodeIdx / nodes.length)) / processList.length;
        let eta = 0;
        if (currentProgressFrac > 0.01) {
          const totalEstimatedTime = elapsed / currentProgressFrac;
          eta = Math.max(0, Math.round(totalEstimatedTime - elapsed));
        }

        triggerProgress({
            currentPercent: Math.round(currentProgressFrac * 100),
            wordsPerSecond: totalWords / elapsed,
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
