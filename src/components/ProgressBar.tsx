
import React from 'react';

interface ProgressBarProps {
  progress: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  return (
    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden shadow-inner">
      <div 
        className="bg-gradient-to-r from-indigo-500 to-indigo-700 h-3 rounded-full transition-all duration-700 ease-out shadow-lg"
        style={{ width: `${Math.max(5, progress)}%` }} 
      />
    </div>
  );
};
