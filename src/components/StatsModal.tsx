import React, { useState } from 'react';
import { BookStats, UILanguage } from '../design';
import { BookStrategy } from '../services/geminiService';
import { 
  BarChart3, Clock, Check, X, AlertCircle, BookOpen, 
  AlignLeft, Gauge, Zap, BrainCircuit, RefreshCw, MessageSquare
} from 'lucide-react';
import { STRINGS_UI } from '../lang/ui';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  stats: BookStats | null;
  strategy?: BookStrategy;
  uiLang: UILanguage;
  hasPaidKey: boolean;
  onRegenerateAnalysis: (feedback: string) => void;
  isAnalyzing: boolean;
}

export const StatsModal: React.FC<StatsModalProps> = ({ 
  isOpen, onClose, onConfirm, stats, strategy, uiLang, hasPaidKey, onRegenerateAnalysis, isAnalyzing 
}) => {
  if (!isOpen || !stats) return null;

  const [activeTab, setActiveTab] = useState<'stats' | 'analysis'>('analysis');
  const [feedback, setFeedback] = useState('');
  const t = STRINGS_UI[uiLang] || STRINGS_UI['en'];
  
  const fmt = (n: number) => n.toLocaleString(uiLang === 'tr' ? 'tr-TR' : 'en-US');
  const duration = hasPaidKey ? stats.estimatedDurationPro : stats.estimatedDurationFree;
  const isHighLoad = stats.estimatedDurationFree > 30;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-slate-950/80 backdrop-blur-xl animate-fade-scale">
      <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-[0_40px_120px_rgba(0,0,0,0.5)] flex flex-col relative overflow-hidden max-h-[90vh]">
        
        {/* Header with Tabs */}
        <div className="flex flex-col md:flex-row justify-between items-center p-6 md:p-8 pb-0 shrink-0 relative z-10 gap-4">
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
              <button 
                onClick={() => setActiveTab('analysis')}
                className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${activeTab === 'analysis' ? 'bg-white dark:bg-slate-700 shadow-md text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <BrainCircuit size={16}/> {t.statsTabAnalysis || "AI STRATEGY"}
              </button>
              <button 
                onClick={() => setActiveTab('stats')}
                className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${activeTab === 'stats' ? 'bg-white dark:bg-slate-700 shadow-md text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <BarChart3 size={16}/> {t.statsTabStats || "STATISTICS"}
              </button>
            </div>
            <button onClick={onClose} disabled={isAnalyzing} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all text-slate-400 absolute top-6 right-6">
                <X size={24} />
            </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 pt-6 relative z-10">
            {activeTab === 'stats' ? (
               <div className="space-y-6">
                  {/* Stats Content (Existing) */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 flex flex-col items-center justify-center gap-1 text-center">
                          <BookOpen size={20} className="text-slate-400 mb-1"/>
                          <span className="text-lg font-black text-slate-700 dark:text-slate-200">{fmt(stats.totalWords)}</span>
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t.statWords}</span>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 flex flex-col items-center justify-center gap-1 text-center">
                          <AlignLeft size={20} className="text-slate-400 mb-1"/>
                          <span className="text-lg font-black text-slate-700 dark:text-slate-200">{fmt(stats.totalChars)}</span>
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t.statChars}</span>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 flex flex-col items-center justify-center gap-1 text-center">
                          <Gauge size={20} className="text-slate-400 mb-1"/>
                          <span className="text-lg font-black text-slate-700 dark:text-slate-200">{fmt(stats.estimatedChunks)}</span>
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t.statRequests}</span>
                      </div>
                      <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-500/20 flex flex-col items-center justify-center gap-1 text-center">
                          <Clock size={20} className="text-indigo-500 mb-1"/>
                          <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">~{duration}m</span>
                          <span className="text-[9px] font-black uppercase text-indigo-400/70 tracking-wider">{t.statDuration}</span>
                      </div>
                  </div>

                  {!hasPaidKey && isHighLoad ? (
                      <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700/30 flex gap-4">
                          <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl h-fit text-amber-600"><AlertCircle size={20}/></div>
                          <div className="space-y-1">
                              <h4 className="font-bold text-amber-700 dark:text-amber-400 text-sm uppercase">{t.statHighLoadTitle}</h4>
                              <p className="text-xs text-amber-800/80 dark:text-amber-200/60 leading-relaxed text-justify">{t.statHighLoadDesc}</p>
                          </div>
                      </div>
                  ) : (
                      <div className="p-5 rounded-2xl bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-700/30 flex gap-4 items-center">
                          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl h-fit text-indigo-600"><Zap size={20}/></div>
                          <div>
                              <h4 className="font-bold text-indigo-700 dark:text-indigo-400 text-sm uppercase">{t.statReady}</h4>
                              <p className="text-xs text-indigo-800/80 dark:text-indigo-200/60">{hasPaidKey ? t.statPaidInfo : t.statFreeInfo}</p>
                          </div>
                      </div>
                  )}
               </div>
            ) : (
               <div className="space-y-6 h-full flex flex-col">
                  {/* Analysis Content */}
                  {strategy ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 space-y-2">
                           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{t.analysisGenre || "GENRE"}</span>
                           <p className="font-bold text-slate-800 dark:text-slate-200">{strategy.genre_translated}</p>
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 space-y-2">
                           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{t.analysisTone || "TONE"}</span>
                           <p className="font-bold text-slate-800 dark:text-slate-200">{strategy.tone_translated}</p>
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 space-y-2">
                           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{t.analysisStyle || "STYLE"}</span>
                           <p className="font-bold text-slate-800 dark:text-slate-200">{strategy.author_style_translated}</p>
                        </div>
                        <div className="col-span-1 md:col-span-3 p-5 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-500/20 space-y-2">
                           <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block">{t.analysisStrategy || "TRANSLATION STRATEGY"}</span>
                           <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 leading-relaxed italic">"{strategy.strategy_translated}"</p>
                        </div>
                      </div>
                  ) : (
                      <div className="flex-1 flex items-center justify-center text-slate-400 italic">{t.noAnalysisData}</div>
                  )}

                  <div className="mt-auto pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <MessageSquare size={12}/> {t.feedbackLabel || "FEEDBACK & REGENERATE"}
                     </label>
                     <div className="flex gap-2">
                        <input 
                           type="text" 
                           value={feedback}
                           onChange={(e) => setFeedback(e.target.value)}
                           placeholder={t.feedbackPlaceholder || "E.g. This is a satire, make it funnier..."}
                           className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
                           disabled={isAnalyzing}
                        />
                        <button 
                           onClick={() => onRegenerateAnalysis(feedback)}
                           disabled={isAnalyzing}
                           className="bg-slate-900 dark:bg-indigo-600 text-white px-5 rounded-xl font-bold text-xs uppercase hover:bg-black dark:hover:bg-indigo-500 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                           <RefreshCw size={14} className={isAnalyzing ? 'animate-spin' : ''}/> 
                           {t.regenerateBtn || "REGENERATE"}
                        </button>
                     </div>
                  </div>
               </div>
            )}
        </div>

        {/* Footer Actions - Updated with padding and border */}
        <div className="p-6 md:p-8 pt-6 border-t border-slate-100 dark:border-slate-800 relative z-10 grid grid-cols-2 gap-4">
            <button onClick={onClose} disabled={isAnalyzing} className="py-4 rounded-2xl font-black text-xs uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                {t.statCancel}
            </button>
            <button onClick={onConfirm} disabled={isAnalyzing} className="py-4 rounded-2xl font-black text-xs uppercase bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {t.statProceed} <Check size={16}/>
            </button>
        </div>

        {/* Background Decor */}
        <div className="absolute top-0 right-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none transform translate-x-1/4 -translate-y-1/4">
            {activeTab === 'stats' ? <BarChart3 size={400} /> : <BrainCircuit size={400} />}
        </div>
      </div>
    </div>
  );
};