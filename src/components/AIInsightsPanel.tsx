import React, { useState } from 'react';
import { AIInsights } from '../engine/aiInsights';
import { AlertTriangle, TrendingUp, Hash, Globe, Activity, Sparkles, Loader2, Zap } from 'lucide-react';
import { getConfig, queryLLM } from '../services/llmService';
import { ComputedMetrics } from '../engine/engineTypes';
import { getSentiment, getDisinformation, getCensorship, getHashtags, DriftData } from '../services/pythonApi';
import { useSocialData } from '../hooks/useSocialData';
import { marked } from 'marked';

interface AIInsightsPanelProps {
  insights: AIInsights | null;
  computedMetrics?: ComputedMetrics;
  driftData?: DriftData | null;
}

function buildLLMContext(metrics: ComputedMetrics, insights: AIInsights | null, pythonContext: string, drift: DriftData | null | undefined): string {
  const top10 = metrics.topInfluencers.slice(0, 10).map((v, i) =>
    `${i + 1}. @${v.label} — Deg:${v.degree} BC:${v.betweenness.toFixed(3)} PR:${v.pagerank.toFixed(3)} Fol:${v.followers}`
  ).join('\n');

  const driftContext = drift ? `

SEMANTIC DRIFT ANALYSIS (from Drift tab):
- Drift Score: ${drift.drift_score.toFixed(2)} (${drift.drift_score > 0.4 ? 'HIGH — significant narrative shift' : 'LOW — stable narrative'})
- Co-opted / Hijacked: ${drift.is_coopted ? 'YES' : 'NO'}
- Early Campaign Topics: ${drift.early_topics.join('; ')}
- Late Campaign Topics: ${drift.late_topics.join('; ')}
- Swahili/Sheng tweets in sample: ${drift.swahili_sheng_count} / ${drift.sample_size}
- Total tweets analysed: ${drift.total_tweets.toLocaleString()}
- Analyst Assessment: ${drift.analysis_text.slice(0, 600)}...` : '';

  return `NETWORK: ${metrics.totalVertices} accounts, ${metrics.totalEdges} edges, density ${metrics.density.toFixed(4)}, ${metrics.connectedComponents} components, reciprocity ${(metrics.reciprocity*100).toFixed(1)}%

TOP 10:
${top10}

${insights ? `Bot score: ${Math.round(insights.botActivityScore*100)}%, Polarization: ${Math.round(insights.polarizationIndex*100)}%` : ''}
${pythonContext}${driftContext}

Generate a concise analysis: key patterns, community structure, influencer dynamics, risks, and recommendations. Use bullet points. Include specific account names and numbers. Keep under 400 words.`;
}

const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({ insights, computedMetrics, driftData }) => {
  const { pythonDatasetId, aiAnalysisResult, setAiAnalysisResult } = useSocialData();
  const [isGenerating, setIsGenerating] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  const handleGenerateAI = async () => {
    if (!computedMetrics) return;
    const config = getConfig();
    if (!config) {
      setLlmError('Server-side LLM is not configured. Add a provider key to the backend environment.');
      return;
    }

    setIsGenerating(true);
    setLlmError(null);
    try {
      let pythonContext = "";
      try {
        const sentimentPromise = pythonDatasetId ? getSentiment(pythonDatasetId).catch(() => null) : Promise.resolve(null);
        const disinfoPromise = pythonDatasetId ? getDisinformation(pythonDatasetId).catch(() => null) : Promise.resolve(null);
        const censorshipPromise = pythonDatasetId ? getCensorship(pythonDatasetId).catch(() => null) : Promise.resolve(null);
        const hashtagsPromise = pythonDatasetId ? getHashtags(pythonDatasetId).catch(() => null) : Promise.resolve(null);

        const [sentiment, disinfo, censorship, hashtags] = await Promise.all([
          sentimentPromise,
          disinfoPromise,
          censorshipPromise,
          hashtagsPromise,
        ]);

        pythonContext = "\nPYTHON BACKEND ANALYSIS RESULTS:\n";
        if (sentiment) {
          pythonContext += `- Sentiment Polarization Index: ${sentiment.polarization_index.toFixed(4)}\n`;
          pythonContext += `- Sentiment Centroid Distance: ${sentiment.centroid_distance.toFixed(4)}\n`;
        }
        if (disinfo) {
          pythonContext += `- Disinformation Score Mean: ${disinfo.score_stats.mean.toFixed(4)}\n`;
          pythonContext += `- Disinformation Risk Levels: Likely Disinfo: ${disinfo.risk_distribution.likely_disinfo}, Suspicious: ${disinfo.risk_distribution.suspicious}, Clean: ${disinfo.risk_distribution.clean}\n`;
        }
        if (censorship) {
          pythonContext += `- Whole-network components: ${censorship.component_count}; Fiedler λ2: ${censorship.fiedler_value.toFixed(4)}; CVI: ${censorship.cvi != null ? censorship.cvi.toFixed(4) : "N/A (disconnected)"}\n`;
          pythonContext += `- Giant component: ${(censorship.largest_component_share * 100).toFixed(1)}% of nodes; Fiedler λ2: ${censorship.largest_component_fiedler?.toFixed(4) ?? "N/A"}; component CVI: ${censorship.component_cvi?.toFixed(6) ?? "N/A"}\n`;
          pythonContext += `- Key Structural Holes: ${censorship.structural_holes.slice(0, 3).map(sh => `@${sh.node} (SI: ${sh.si_score.toFixed(3)})`).join(', ')}\n`;
        }
        if (hashtags) {
          pythonContext += `- Hashtag Count: ${hashtags.hashtag_count}\n`;
          pythonContext += `- Artificial Campaign Probability Ratio: ${(hashtags.artificial_ratio * 100).toFixed(1)}%\n`;
        }
      } catch (err) {
        console.warn("Could not fetch python context for Semantic Insights:", err);
      }

      const context = buildLLMContext(computedMetrics, insights, pythonContext, driftData);
      const prompt = `You are a social network analysis expert at SIMElab Africa. Analyze this network data and provide key insights. Be specific, cite numbers, and identify patterns. Use markdown formatting.`;
      const result = await queryLLM(prompt, context);
      setAiAnalysisResult(result);
    } catch (err: unknown) {
      setLlmError(err instanceof Error ? err.message : 'Failed to generate insights');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!insights) return null;
  return (
    <div className="space-y-6">
      {/* Semantic insights section */}
      <div className="bg-gradient-to-r from-[#0f172a]/50 to-[#8b5cf6]/5 border border-[#8b5cf6]/20 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#8b5cf6]/20 rounded-lg flex items-center justify-center">
              <Sparkles size={16} className="text-[#8b5cf6]" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Semantic Analysis</h3>
              <p className="text-[10px] text-text-muted">
                Uses TokenRouter / NVIDIA NIM / DeepSeek for deeper context
                {driftData && <span className="ml-2 px-1.5 py-0.5 bg-[#facc15]/10 text-[#facc15] rounded text-[9px] font-bold">+ Drift Context</span>}
              </p>
            </div>
          </div>
          {!isGenerating && (
            <button
              onClick={handleGenerateAI}
              className="flex items-center gap-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all active:scale-95 disabled:opacity-50"
            >
              {aiAnalysisResult ? <><Zap size={14} /> Regenerate</> : <><Zap size={14} /> Generate Semantic Insights</>}
            </button>
          )}
        </div>

        {isGenerating && (
          <div className="flex items-center gap-3 py-8 justify-center text-text-muted">
            <Loader2 size={18} className="animate-spin text-[#8b5cf6]" />
            <span className="text-sm">Analyzing network patterns automatically...</span>
          </div>
        )}

        {llmError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-red-400">
            {llmError}
          </div>
        )}

        {aiAnalysisResult && (
          <div className="bg-[#0a0f1e] border border-white/5 rounded-xl p-5 mt-3">
            <div
              className="text-xs leading-relaxed text-text-secondary markdown-content"
              dangerouslySetInnerHTML={{
                __html: marked.parse(aiAnalysisResult, { breaks: true, gfm: true }) as string,
              }}
            />
            <button
              onClick={() => { setAiAnalysisResult(null); setLlmError(null); }}
              className="mt-3 text-[10px] text-text-muted hover:text-white transition-colors"
            >
              Clear & regenerate
            </button>
          </div>
        )}
      </div>

      {/* Key metrics row */}
      {insights && (
        <div className="grid grid-cols-2 gap-3">
          <MiniStatCard
            icon={<Activity size={14} />}
            label="Bot Activity"
            value={`${Math.round(insights.botActivityScore * 100)}%`}
            color={insights.botActivityScore > 0.2 ? 'text-red-400' : 'text-green-400'}
          />
          <MiniStatCard
            icon={<TrendingUp size={14} />}
            label="Polarization"
            value={`${Math.round(insights.polarizationIndex * 100)}%`}
            color={insights.polarizationIndex > 0.5 ? 'text-yellow-400' : 'text-green-400'}
          />
          <MiniStatCard
            icon={<Hash size={14} />}
            label="Narratives"
            value={insights.keyNarratives.length.toString()}
            color="text-blue-400"
          />
          <MiniStatCard
            icon={<Globe size={14} />}
            label="Platforms"
            value={insights.platformBreakdown.length.toString()}
            color="text-emerald-400"
          />
        </div>
      )}

      {/* Key Narratives */}
      {insights && insights.keyNarratives.length > 0 && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
          <h3 className="text-sm font-bold tracking-tight mb-4">Key Narratives (from text analysis)</h3>
          <div className="space-y-3">
            {insights.keyNarratives.slice(0, 5).map((n, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/5">
                <div className="w-8 h-8 bg-[#8b5cf6]/10 rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-[#8b5cf6]">{n.postCount}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-white capitalize">{n.theme}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      n.dominantSentiment === 'Positive' ? 'bg-green-500/20 text-green-400' :
                      n.dominantSentiment === 'Negative' ? 'bg-red-500/20 text-red-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>{n.dominantSentiment}</span>
                  </div>
                  {n.examplePosts[0] && (
                    <p className="text-[10px] text-text-muted truncate">"{n.examplePosts[0].slice(0, 100)}..."</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {insights && insights.keyNarratives.length === 0 && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6 text-center">
          <p className="text-xs text-text-muted">
            No text content found in dataset — narratives require tweet/post text.
            Narrative detection works on datasets with content columns.
          </p>
        </div>
      )}

      {/* Suspicious Accounts */}
      {insights && insights.suspiciousAccounts.length > 0 && (
        <div className="bg-[#0f172a]/30 border border-red-500/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center">
              <AlertTriangle size={16} className="text-red-400" />
            </div>
            <h3 className="text-sm font-bold tracking-tight text-red-400">Suspicious Activity Detected</h3>
          </div>
          <div className="space-y-2">
            {insights.suspiciousAccounts.map((acc, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-red-500/5 rounded-xl border border-red-500/10">
                <div>
                  <p className="text-xs font-bold text-white">@{acc.label}</p>
                  <p className="text-[10px] text-text-muted">{acc.reasons[0]}</p>
                </div>
                <div className="w-12 h-12 relative flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#1e293b" strokeWidth="4" />
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#ef4444"
                      strokeWidth="4" strokeDasharray="126"
                      strokeDashoffset={126 - (126 * acc.score)}
                      strokeLinecap="round" />
                  </svg>
                  <span className="absolute text-[10px] font-black text-red-400">{Math.round(acc.score * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hashtag Trends */}
      {insights && insights.hashtagTrends.length > 0 && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
          <h3 className="text-sm font-bold tracking-tight mb-4">Trending Hashtags</h3>
          <div className="flex flex-wrap gap-2">
            {insights.hashtagTrends.map((h, i) => (
              <span key={i}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  h.sentiment === 'Positive' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                  h.sentiment === 'Negative' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                  'bg-slate-500/10 text-slate-400 border-slate-500/20'
                }`}
                style={{ fontSize: `${Math.max(9, Math.min(14, 9 + h.count / 5))}px` }}
              >
                {h.hashtag} ({h.count})
              </span>
            ))}
          </div>
        </div>
      )}

      {insights && insights.hashtagTrends.length === 0 && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6 text-center">
          <Hash size={24} className="text-text-muted mx-auto mb-3 opacity-30" />
          <p className="text-xs text-text-muted">
            No hashtags found in this dataset.
            Dataset may not contain tweet/post text — hashtags are extracted from content columns.
          </p>
        </div>
      )}
    </div>
  );
};

const MiniStatCard = ({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) => (
  <div className="bg-[#0f172a]/30 border border-white/5 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <span className={color}>{icon}</span>
      <span className="text-[10px] font-bold text-text-muted uppercase">{label}</span>
    </div>
    <p className={`text-lg font-black ${color}`}>{value}</p>
  </div>
);

export default AIInsightsPanel;
