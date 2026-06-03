import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Settings, Key, X, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { marked } from 'marked';
import {
  queryLLMStreaming, getConfig, saveConfig, clearConfig,
  LLMProvider
} from '../services/llmService';
import { ComputedMetrics } from '../engine/engineTypes';
import { AIInsights } from '../engine/aiInsights';
import type { GraphData } from '../engine/csvParserEnhanced';

interface ChatPanelProps {
  graphData: GraphData;
  computedMetrics: ComputedMetrics;
  aiInsights: AIInsights | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

function buildContext(data: GraphData, metrics: ComputedMetrics, insights: AIInsights | null): string {
  const top5Deg = metrics.topInfluencers.slice(0, 5).map((v, i) =>
    `  ${i + 1}. @${v.label} — Degree: ${v.degree}, Betweenness: ${v.betweenness.toFixed(4)}, PageRank: ${v.pagerank.toFixed(3)}, Followers: ${v.followers}`
  ).join('\n');

  const top5Btw = metrics.topBetweenness.slice(0, 5).map((v, i) =>
    `  ${i + 1}. @${v.label} — Betweenness: ${v.betweenness.toFixed(4)}, Cluster: Community ${v.cluster + 1}`
  ).join('\n');

  const clusters = new Map<number, number>();
  data.vertices.forEach(v => clusters.set(v.cluster, (clusters.get(v.cluster) || 0) + 1));

  return `NETWORK SUMMARY:
- Total accounts (vertices): ${metrics.totalVertices}
- Total connections (edges): ${metrics.totalEdges}
- Network density: ${metrics.density.toFixed(4)}
- Network diameter: ${metrics.diameter}
- Connected components: ${metrics.connectedComponents}
- Average degree: ${metrics.avgDegree.toFixed(1)}
- Average clustering coefficient: ${metrics.avgClusteringCoefficient.toFixed(4)}
- Reciprocity: ${(metrics.reciprocity * 100).toFixed(1)}%

SENTIMENT:
- Positive: ${metrics.sentimentDistribution.Pos} (${Math.round(metrics.sentimentDistribution.Pos / Math.max(metrics.totalVertices, 1) * 100)}%)
- Neutral: ${metrics.sentimentDistribution.Neu}
- Negative: ${metrics.sentimentDistribution.Neg}

TOP INFLUENCERS (by degree):
${top5Deg}

TOP BRIDGE ACCOUNTS (by betweenness):
${top5Btw}

COMMUNITIES: ${clusters.size} communities detected
${[...clusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cid, size]) => `  - Community ${cid + 1}: ${size} members`).join('\n')}

${insights ? `AI INSIGHTS:
- Bot activity score: ${Math.round(insights.botActivityScore * 100)}%
- Polarization index: ${Math.round(insights.polarizationIndex * 100)}%
- Key narratives: ${insights.keyNarratives.slice(0, 3).map(n => n.theme).join(', ')}
- Suspicious accounts flagged: ${insights.suspiciousAccounts.length}` : ''}`;
}

const SUGGESTED_QUESTIONS = [
  'What are the key insights from this network?',
  'Who are the most influential accounts and why?',
  'What communities exist and how do they differ?',
  'Is there evidence of coordinated activity?',
  'Generate a 3-paragraph analytical brief of the key findings.',
  'What does the sentiment distribution tell us about this conversation?',
  'Compare the top 3 influencers — who bridges communities best?',
  'What recommendations would you make based on this data?',
];

function renderMarkdown(text: string): string {
  return marked.parse(text, { breaks: true, gfm: true }) as string;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ graphData, computedMetrics, aiInsights }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<LLMProvider>('deepseek');
  const [streamingContent, setStreamingContent] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const config = getConfig();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const context = buildContext(graphData, computedMetrics, aiInsights);

  const sendMessage = async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: question, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      let fullResponse = '';
      await queryLLMStreaming(question, context, (chunk) => {
        fullResponse += chunk;
        setStreamingContent(fullResponse);
      });
      setMessages(prev => [...prev, { role: 'assistant', content: fullResponse, timestamp: Date.now() }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}`, timestamp: Date.now() }]);
    } finally {
      setStreamingContent('');
      setIsLoading(false);
    }
  };

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      saveConfig(provider, apiKey.trim());
      setShowSettings(false);
      setApiKey('');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#8b5cf6]/20 rounded-lg flex items-center justify-center">
            <Bot size={16} className="text-[#8b5cf6]" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">AI Analyst Chat</h3>
            <p className="text-[10px] text-text-muted">
              {config ? `${config.provider === 'deepseek' ? 'DeepSeek' : 'NVIDIA NIM'} • ${config.model}` : 'No API key configured'}
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowSettings(true); setProvider(config?.provider || 'deepseek'); }}
          className="p-2 hover:bg-white/5 rounded-lg transition-colors text-text-muted hover:text-white"
          title="API Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 custom-scrollbar">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <Bot size={40} className="text-text-muted mx-auto mb-4 opacity-30" />
            <p className="text-sm text-text-muted mb-6">Ask me anything about this dataset</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
              {SUGGESTED_QUESTIONS.slice(0, 4).map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-[10px] text-text-secondary bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 px-3 py-2 rounded-xl transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 bg-[#8b5cf6]/20 rounded-lg flex items-center justify-center shrink-0 mt-1">
                  <Bot size={14} className="text-[#8b5cf6]" />
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                  ? 'bg-[#facc15] text-[#050a14]'
                  : 'bg-[#0f172a]/50 border border-white/5 text-text-secondary'
                }`}>
                {msg.role === 'assistant' ? (
                  <div
                    className="text-xs leading-relaxed markdown-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 bg-[#facc15]/20 rounded-lg flex items-center justify-center shrink-0 mt-1">
                  <User size={14} className="text-[#facc15]" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {streamingContent && (
          <div className="flex gap-3">
            <div className="w-7 h-7 bg-[#8b5cf6]/20 rounded-lg flex items-center justify-center shrink-0 mt-1">
              <Loader2 size={14} className="text-[#8b5cf6] animate-spin" />
            </div>
            <div className="max-w-[85%] bg-[#0f172a]/50 border border-white/5 rounded-2xl px-4 py-3">
              <div
                className="text-xs leading-relaxed markdown-content text-text-secondary"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }}
              />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
          placeholder={config ? 'Ask about this dataset...' : 'Configure API key to start...'}
          disabled={!config || isLoading}
          className="flex-1 bg-[#0a1120] border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-[#8b5cf6] disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!config || isLoading || !input.trim()}
          className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-bold py-3 px-4 rounded-xl flex items-center gap-2 text-sm transition-all active:scale-95 disabled:opacity-50"
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="p-3 hover:bg-white/5 rounded-xl transition-colors text-text-muted hover:text-red-400"
            title="Clear chat"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0f172a] border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Key size={18} className="text-[#8b5cf6]" />
                  <h3 className="text-sm font-bold">LLM API Settings</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-white/5 rounded-lg">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-text-muted uppercase block mb-2">Provider</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['deepseek', 'nvidia-nim'] as LLMProvider[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setProvider(p)}
                        className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all ${provider === p
                            ? 'bg-[#8b5cf6]/20 border-[#8b5cf6] text-[#8b5cf6]'
                            : 'bg-white/[0.02] border-white/5 text-text-secondary hover:border-white/10'
                          }`}
                      >
                        {p === 'deepseek' ? 'DeepSeek' : 'NVIDIA NIM'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-text-muted uppercase block mb-2">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="nvapi-... or sk-..."
                    className="w-full bg-[#0a1120] border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-[#8b5cf6]"
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  />
                  <p className="text-[9px] text-text-muted mt-2">
                    Key stored locally in your browser only. Never sent to our servers.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveKey}
                    disabled={!apiKey.trim()}
                    className="flex-1 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-bold py-3 rounded-xl text-sm transition-all disabled:opacity-50"
                  >
                    Save Key
                  </button>
                  {config && (
                    <button
                      onClick={() => { clearConfig(); setShowSettings(false); }}
                      className="px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl text-sm font-bold transition-all"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatPanel;
