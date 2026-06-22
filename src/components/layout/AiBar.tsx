import { useState } from 'react';
import { MessageSquare, Sparkles, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { useSocialData } from '../../hooks/useSocialData';
import ChatPanel from '../ChatPanel';
import AIInsightsPanel from '../AIInsightsPanel';

export function AiBar() {
  const { graphData, computedMetrics, aiInsights, driftData } = useSocialData();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'analysis'>('chat');

  if (!graphData || !computedMetrics) return null;

  return (
    <div className="flex shrink-0 h-full relative z-40">
      {/* Trigger Button Strip when Collapsed */}
      <div className="w-12 border-l border-rule bg-paper-2 flex flex-col items-center py-4 gap-4 select-none shrink-0 h-full">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-paper-3 text-ink-soft hover:text-ink transition-colors border border-rule rounded-lg"
          title={isOpen ? 'Collapse Panel' : 'Expand Panel'}
        >
          {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <div className="w-full h-px bg-rule" />

        <button
          onClick={() => {
            setActiveTab('chat');
            setIsOpen(true);
          }}
          className={`p-2 rounded-lg transition-colors border ${
            isOpen && activeTab === 'chat'
              ? 'border-ember text-ember bg-ember-soft'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-paper-3'
          }`}
          title="Analyst Chat"
        >
          <MessageSquare size={16} />
        </button>

        <button
          onClick={() => {
            setActiveTab('analysis');
            setIsOpen(true);
          }}
          className={`p-2 rounded-lg transition-colors border ${
            isOpen && activeTab === 'analysis'
              ? 'border-ember text-ember bg-ember-soft'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-paper-3'
          }`}
          title="Semantic Narrative Analysis"
        >
          <Sparkles size={16} />
        </button>
      </div>

      {/* Expanded Panel Body */}
      {isOpen && (
        <div className="w-[380px] border-l border-rule bg-paper flex flex-col h-full overflow-hidden transition-all duration-300">
          {/* Header */}
          <div className="h-14 border-b border-rule flex items-center justify-between px-4 shrink-0 select-none">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('chat')}
                className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === 'chat' ? 'text-ink border-ember' : 'text-ink-mute border-transparent hover:text-ink-soft'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === 'analysis' ? 'text-ink border-ember' : 'text-ink-mute border-transparent hover:text-ink-soft'
                }`}
              >
                Analysis
              </button>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-paper-2 text-ink-soft hover:text-ink border border-rule rounded"
              title="Close Drawer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Drawer Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0 custom-scrollbar flex flex-col">
            {activeTab === 'chat' && (
              <ChatPanel
                graphData={graphData}
                computedMetrics={computedMetrics}
                aiInsights={aiInsights}
                driftData={driftData}
                isSidebar={true}
              />
            )}
            {activeTab === 'analysis' && (
              <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                <AIInsightsPanel
                  insights={aiInsights}
                  computedMetrics={computedMetrics}
                  driftData={driftData}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
