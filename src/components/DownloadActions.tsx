import React from 'react';
import { Download } from 'lucide-react';

interface DownloadActionsProps {
    downloadUrl: string | null;
    fileName: string;
    t: any;
}

export const DownloadActions: React.FC<DownloadActionsProps> = ({ downloadUrl, fileName, t }) => {
    if (!downloadUrl) return null;

    return (
        <div className="w-full flex flex-col gap-4 animate-fade-scale">
            <a 
                href={downloadUrl} 
                download={`translated_${fileName}`} 
                className="w-full flex items-center justify-center gap-4 p-5 md:p-7 bg-green-600 text-white rounded-[2rem] md:rounded-[2.5rem] font-black shadow-2xl hover:bg-green-700 transition-all text-lg md:text-xl"
            >
                <Download size={24} /> {t.downloadBtn}
            </a>
        </div>
    );
};