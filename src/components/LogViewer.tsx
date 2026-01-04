import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../services/epubService';
import { Check, AlertCircle, Info, Activity, Clock, Terminal } from 'lucide-react';

interface LogViewerProps {
  logs: LogEntry[];
  readyText: string;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, readyText }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Sadece kullanıcı yukarı kaydırmamışsa otomatik kaydır
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      // Eğer kullanıcı en alttan 100px içerisindeyse otomatik kaydırmaya devam et
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      
      if (isAtBottom) {
        // scrollIntoView yerine element bazlı scrollTo kullanarak sayfanın zıplamasını engelliyoruz
        containerRef.current.scrollTo({
          top: scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-3 opacity-60">
        <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse">
            <Terminal size={24} strokeWidth={1.5} />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest">{readyText}</p>
      </div>
    );
  }

  const getTypeStyles = (type?: string) => {
    switch (type) {
      case 'success': return {
        container: 'bg-green-50/50 dark:bg-green-900/10 border-l-green-500',
        icon: <Check size={12} className="text-green-600 dark:text-green-400" />,
        text: 'text-green-800 dark:text-green-200'
      };
      case 'error': return {
        container: 'bg-red-50/50 dark:bg-red-900/10 border-l-red-500',
        icon: <AlertCircle size={12} className="text-red-600 dark:text-red-400" />,
        text: 'text-red-800 dark:text-red-200'
      };
      case 'warning': return {
        container: 'bg-amber-50/50 dark:bg-amber-900/10 border-l-amber-500',
        icon: <Clock size={12} className="text-amber-600 dark:text-amber-400" />,
        text: 'text-amber-800 dark:text-amber-200'
      };
      case 'live': return {
        container: 'bg-indigo-50/50 dark:bg-indigo-900/10 border-l-indigo-500 border-dashed',
        icon: <Activity size={12} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />,
        text: 'text-indigo-800 dark:text-indigo-200 font-serif italic'
      };
      default: return {
        container: 'bg-slate-50/50 dark:bg-slate-800/30 border-l-slate-300 dark:border-l-slate-600',
        icon: <Info size={12} className="text-slate-500 dark:text-slate-400" />,
        text: 'text-slate-700 dark:text-slate-300'
      };
    }
  };

  return (
    <div className="h-full rounded-xl bg-white dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/50 p-1">
      <div ref={containerRef} className="h-full overflow-y-auto custom-scrollbar px-1 py-1">
        <div className="flex flex-col gap-1.5 pb-2">
          {logs.map((log, index) => {
            const styles = getTypeStyles(log.type);
            return (
              <div 
                key={index} 
                className={`flex items-start gap-3 p-2.5 rounded-lg border-l-2 transition-all hover:bg-opacity-80 animate-fade-scale ${styles.container}`}
                style={{ animationDelay: `${Math.min(index * 0.05, 0.5)}s` }}
              >
                <div className="shrink-0 pt-0.5 opacity-80">
                    {styles.icon}
                </div>
                <div className="flex flex-col gap-0.5 w-full min-w-0">
                    <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500 leading-none">
                        {log.timestamp}
                    </span>
                    <span className={`text-[11px] leading-snug font-medium break-words ${styles.text}`}>
                        {log.text}
                    </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};