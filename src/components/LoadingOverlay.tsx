import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Network, Brain, GitBranch, BarChart3, Activity } from 'lucide-react';

interface LoadingOverlayProps {
  isVisible: boolean;
  stage: string;
  subStage: string;
  progress: number; // 0-100
}

const stages = [
  { id: 'parsing', label: 'Parsing file', icon: Activity },
  { id: 'metrics', label: 'Computing SNA metrics', icon: BarChart3 },
  { id: 'communities', label: 'Detecting communities', icon: GitBranch },
  { id: 'graph', label: 'Building network graph', icon: Network },
  { id: 'ai', label: 'Running AI analysis', icon: Brain },
  { id: 'done', label: 'Analysis complete', icon: CheckCircle2 },
];

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible, stage, progress }) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, [isVisible]);

  const stageIndex = stages.findIndex(s => s.id === stage);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-[#050a14]/95 backdrop-blur-sm z-50 flex items-center justify-center"
        >
          <div className="w-full max-w-md mx-4 space-y-8">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-black text-text-muted uppercase tracking-widest">
                <span>Processing</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#8b5cf6] to-[#facc15] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Stage indicators */}
            <div className="space-y-2">
              {stages.map((s, i) => {
                const isActive = i === stageIndex;
                const isDone = i < stageIndex;
                const Icon = s.icon;

                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${isActive
                        ? 'bg-[#8b5cf6]/10 border border-[#8b5cf6]/20'
                        : isDone
                          ? 'opacity-60'
                          : 'opacity-30'
                      }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isActive
                        ? 'bg-[#8b5cf6]/20 text-[#8b5cf6]'
                        : isDone
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-white/5 text-text-muted'
                      }`}>
                      {isActive ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : isDone ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <Icon size={14} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${isActive ? 'text-white' : 'text-text-muted'}`}>
                        {s.label}
                      </p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] text-[#8b5cf6] font-bold animate-pulse">{dots}</span>
                    )}
                    {isDone && (
                      <CheckCircle2 size={12} className="text-green-400" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Helper text */}
            <p className="text-center text-[10px] text-text-muted">
              Processing {stage === 'parsing' ? 'file' : stage === 'graph' ? 'network layout' : 'data'} — this may take a moment for large datasets
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LoadingOverlay;
