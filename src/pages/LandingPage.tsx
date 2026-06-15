import React, { useState, useRef } from 'react';
import { FileText, X, CheckCircle2, Loader2, Satellite, Zap, Folder } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import simelogo from '../../simelogo.jpeg';

interface LandingPageProps {
    onFileProcessed: (file: File) => void;
    onLoadDemo: () => void;
    isLoading?: boolean;
}

const LandingPage: React.FC<LandingPageProps> = ({ onFileProcessed, onLoadDemo, isLoading }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.xlsx'))) {
            setFile(droppedFile);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
        }
    };

    const handleStartAnalysis = () => {
        if (file) {
            onFileProcessed(file);
        }
    };

    return (
        <div className="w-full flex flex-col items-center justify-start p-10 bg-[#050a14] pt-20">
            <div className="max-w-2xl w-full text-center mb-10 animate-fade-in flex flex-col items-center">
                <div className="text-accent-primary/60 mb-8">
                    <Satellite size={120} className="stroke-[1.5]" />
                </div>
                <h2 className="text-5xl font-black mb-6 text-white tracking-tighter">
                    Upload Your NodeXL CSV
                </h2>
                <p className="text-text-secondary text-base max-w-lg leading-relaxed">
                    Export your data from NodeXL, then upload the CSV file here. The platform will automatically detect the columns and run the full analysis — topic modelling, sentiment tracking, influencer mapping, and a full report.
                </p>
            </div>

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".csv,.xlsx"
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`w-full max-w-xl aspect-[16/10] bg-white/[0.02] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-8 transition-all duration-300 ${isDragging ? 'border-accent-secondary bg-accent-secondary/5' : 'border-[#facc15]/30 hover:border-[#facc15]/50'
                    }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
            >
                <AnimatePresence mode="wait">
                    {!file ? (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-col items-center cursor-pointer"
                        >
                            <div className="w-20 h-20 bg-[#facc15]/10 rounded-xl flex items-center justify-center mb-8">
                                <Folder className="text-[#facc15] fill-[#facc15]/20" size={40} />
                            </div>
                            <h3 className="text-3xl font-black mb-3 text-white">Drop NodeXL CSV File Here</h3>
                            <p className="text-text-secondary text-sm font-medium">or click to browse · .csv files only</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="file"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full flex flex-col items-center"
                        >
                            <div className="w-full p-6 bg-white/[0.03] rounded-2xl border border-white/10 flex items-center gap-4 mb-8">
                                <div className="w-14 h-14 bg-accent-primary/20 rounded flex items-center justify-center text-accent-primary border border-accent-primary/20">
                                    <FileText size={28} />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-base font-bold text-white truncate max-w-[280px]">{file.name}</p>
                                    <p className="text-xs text-text-muted font-medium mt-1">{(file.size / 1024).toFixed(2)} KB • Ready for analysis</p>
                                </div>
                                {!isLoading && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white"
                                    >
                                        <X size={20} />
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={(e) => { e.stopPropagation(); handleStartAnalysis(); }}
                                className="bg-accent-secondary hover:bg-yellow-500 text-bg-primary font-bold py-3.5 px-8 rounded-xl flex items-center gap-3 text-sm transition-all active:scale-95 shadow-xl shadow-yellow-500/10"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <Loader2 size={20} className="animate-spin" />
                                ) : (
                                    <CheckCircle2 size={20} className="stroke-[3]" />
                                )}
                                {isLoading ? 'Processing Dataset...' : 'Start Intelligence Analysis'}
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <div className="mt-8 flex flex-col items-center gap-4">
                <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Supported NodeXL column names (auto-detected):</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-2xl px-10">
                    {[
                        'Tweet / Text', 'Twitter Screen Name', 'Followers', 'Retweets',
                        'Favorites', 'Betweenness Centrality', 'Hashtags', 'Date',
                        'Sentiment', 'PageRank', 'In-Degree', 'Out-Degree'
                    ].map(tag => (
                        <span key={tag} className="px-5 py-2 bg-[#1e293b]/50 border border-white/5 rounded-full text-[11px] font-bold text-text-secondary whitespace-nowrap hover:bg-[#1e293b] transition-colors cursor-default">
                            {tag}
                        </span>
                    ))}
                </div>
            </div>

            <div className="mt-12 flex flex-col items-center gap-4">
                <div className="mt-16 flex items-center gap-3 opacity-40">
                    <img src={simelogo} alt="SIME Logo" className="w-6 h-6 rounded object-cover" />
                    <p className="text-sm text-text-muted font-bold uppercase tracking-[0.3em]">
                        Powered by Simelab and Dcamd
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LandingPage;
