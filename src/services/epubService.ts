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
export async function calculateEpubStats(file: File, targetTags: string[]): Promise<BookStats> {
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
  const estimatedTokens = Math.ceil(totalChars / 3.5); // Biraz güvenlik payı
  
  // Bir chunk ortalama 2000 karakter civarında gönderilir (sistemin parçalama mantığına göre değişir ama ortalama bu)
  // Veya her düğüm ayrı çevriliyorsa düğüm sayısı daha önemli olabilir. 
  // Burada "istek sayısı"nı tahmin etmeye çalışıyoruz.
  // Gemini'ye her paragraf ayrı gidiyor varsayımıyla (mevcut kodda node-by-node):
  // Ortalama bir paragraf 300 karakter desek:
  const estimatedChunks = Math.ceil(totalChars / 400); 

  // Süre Hesaplaması
  // Free Tier: 15 RPM (Dakikada 15 istek).
  // Paid Tier: Latency based (~3 sn/istek).
  
  // Free: İstek sayısı / 15 + (İşlem süresi)
  const durationFree = Math.ceil(estimatedChunks / 12); // Dakika (RPM limitine takılacağı için)
  
  // Pro: Paralel işlem yoksa seri ilerler.
  // Ortalama 2-3 saniye sürse bir istek.
  const durationPro = Math.ceil((estimatedChunks * 2.5) / 60); // Dakika

  return {
    totalChars,
    totalWords,
    totalSentences,
    estimatedTokens,
    estimatedChunks,
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