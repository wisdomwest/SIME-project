/**
 * PythonAnalysisTabs.tsx — Rich analysis views powered by the SIMElab Python backend.
 *
 * Adds four tabs:
 *   - Sentiment (k-means clustering with silhouette, polarization, centroid distance)
 *   - Disinformation (5-signal scoring with breakdown)
 *   - Hashtags (lifecycle + GMM authenticity)
 *   - Censorship (structural holes + CVI + Fiedler value)
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MessageCircle, AlertTriangle, Hash, Shield, Loader2, Zap, Download,
} from 'lucide-react';
import {
  getSentiment, getDisinformation, getHashtags, getCensorship,
  SentimentData, DisinfoData, HashtagData, CensorshipData,
} from '../services/pythonApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PythonAnalysisTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  datasetId?: string;
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

// ─── Main Component ─────────────────────────────────────────────────────────

const PythonAnalysisTabs: React.FC<PythonAnalysisTabsProps> = ({
  activeTab, onTabChange, datasetId = 'default',
}) => {
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [disinfo, setDisinfo] = useState<DisinfoData | null>(null);
  const [hashtags, setHashtags] = useState<HashtagData | null>(null);
  const [censorship, setCensorship] = useState<CensorshipData | null>(null);
  const [loadState, setLoadState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Load all analyses when component mounts
  useEffect(() => {
    if (loadState !== 'idle') return;
    setLoadState('loading');

    Promise.allSettled([
      getSentiment(datasetId).then(setSentiment),
      getDisinformation(datasetId).then(setDisinfo),
      getHashtags(datasetId).then(setHashtags),
      getCensorship(datasetId).then(setCensorship),
    ]).then((results) => {
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length === 4) {
        setError('All analyses failed. Is the Python backend running? (npm run python)');
        setLoadState('error');
      } else {
        setLoadState('loaded');
      }
    }).catch(() => {
      setError('Failed to connect to Python backend.');
      setLoadState('error');
    });
  }, [datasetId]);

  // ─── Loading / Error States ───────────────────────────────────────────

  if (loadState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 size={32} className="text-[#facc15] animate-spin" />
        <p className="text-sm text-text-secondary">Running Python analysis engine...</p>
        <p className="text-[10px] text-text-muted">K-means clustering · Disinfo scoring · Structural holes · Hashtag GMM</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-sm text-text-secondary">{error || 'Analysis unavailable'}</p>
        <button
          onClick={() => { setLoadState('idle'); setError(null); }}
          className="px-4 py-2 bg-[#facc15] text-[#050a14] rounded-lg text-xs font-bold mt-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── Tab navigation ───────────────────────────────────────────────────

  const tabs = [
    { id: 'pysentiment', label: 'Sentiment', icon: MessageCircle, count: sentiment?.labels?.length },
    { id: 'pydisinfo', label: 'Disinfo', icon: AlertTriangle, count: disinfo?.scores?.length },
    { id: 'pyhashtags', label: 'Hashtags', icon: Hash, count: hashtags?.hashtag_count },
    { id: 'pycensorship', label: 'Censorship', icon: Shield, count: censorship?.structural_holes?.length },
  ];

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Sub-tab bar */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-xl p-1 flex gap-1 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#facc15] text-[#050a14]'
                : 'text-text-secondary hover:bg-white/5'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* SENTIMENT TAB */}
      {activeTab === 'pysentiment' && sentiment && <SentimentView data={sentiment} />}

      {/* DISINFORMATION TAB */}
      {activeTab === 'pydisinfo' && disinfo && <DisinfoView data={disinfo} />}

      {/* HASHTAGS TAB */}
      {activeTab === 'pyhashtags' && hashtags && <HashtagView data={hashtags} />}

      {/* CENSORSHIP TAB */}
      {activeTab === 'pycensorship' && censorship && <CensorshipView data={censorship} />}
    </div>
  );
};

// ─── Sentiment View ─────────────────────────────────────────────────────────

const SentimentView: React.FC<{ data: SentimentData }> = ({ data }) => {
  const total = data.clusters.Neg + data.clusters.Neu + data.clusters.Pos;
  const posPct = total ? (data.clusters.Pos / total) * 100 : 0;
  const neuPct = total ? (data.clusters.Neu / total) * 100 : 0;
  const negPct = total ? (data.clusters.Neg / total) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Method badge */}
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-[#facc15]" />
        <span className="text-[10px] font-black text-[#facc15] uppercase tracking-widest">
          K-Means++ on 9-D Network Features
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Silhouette" value={data.silhouette?.toFixed(4) || 'N/A'}
          subtitle={data.silhouette && data.silhouette > 0.5 ? 'Good clustering' : 'Fair/Poor'} accent="border-[#10b981]" />
        <StatCard title="Polarization" value={data.polarization_index.toFixed(3)}
          subtitle={`${(data.polarization_index * 100).toFixed(0)}% in extremes`} accent="border-[#f59e0b]" />
        <StatCard title="Centroid Dist" value={data.centroid_distance.toFixed(4)}
          subtitle={data.centroid_distance < 1 ? '< 1.0 — unreliable' : '≥ 1.0 — reliable'} accent="border-[#3b82f6]" />
        <StatCard title="Total" value={total.toString()} subtitle="nodes clustered" accent="border-[#8b5cf6]" />
      </div>

      {/* Pie chart + legend */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-6">Sentiment Distribution (Structural Clusters)</h3>
        <div className="flex items-center justify-center gap-16 flex-wrap">
          {/* Donut */}
          <div className="relative w-48 h-48">
            <svg className="w-full h-full -rotate-90">
              <circle cx="96" cy="96" r="80" fill="none" stroke="#1e293b" strokeWidth="16" />
              {(() => {
                const circ = 2 * Math.PI * 80;
                return (
                  <>
                    <circle cx="96" cy="96" r="80" fill="none" stroke="#10b981"
                      strokeWidth="16" strokeDasharray={circ}
                      strokeDashoffset={circ - circ * (posPct / 100)}
                      strokeLinecap="round" />
                    <circle cx="96" cy="96" r="80" fill="none" stroke="#64748b"
                      strokeWidth="16" strokeDasharray={circ}
                      strokeDashoffset={circ - circ * ((posPct + neuPct) / 100)}
                      strokeLinecap="round"
                      transform={`rotate(${posPct * 3.6} 96 96)`} />
                    <circle cx="96" cy="96" r="80" fill="none" stroke="#ef4444"
                      strokeWidth="16" strokeDasharray={circ}
                      strokeDashoffset={circ - circ * (negPct / 100)}
                      strokeLinecap="round"
                      transform={`rotate(${(posPct + neuPct) * 3.6} 96 96)`} />
                  </>
                );
              })()}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black">{total}</span>
              <span className="text-[10px] text-text-muted font-black uppercase tracking-widest">Nodes</span>
            </div>
          </div>
          {/* Legend */}
          <div className="space-y-4">
            <Legend color="bg-red-500" label="Negative (broadcasters)" count={data.clusters.Neg} total={total}
              detail="High out-degree, low reciprocity" />
            <Legend color="bg-slate-500" label="Neutral (observers)" count={data.clusters.Neu} total={total}
              detail="Balanced metrics" />
            <Legend color="bg-green-500" label="Positive (connectors)" count={data.clusters.Pos} total={total}
              detail="High reciprocity + betweenness" />
          </div>
        </div>
      </div>

      {/* Interpretation */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-3">Interpretation</h3>
        <div className="text-xs text-text-secondary space-y-2">
          <p>
            <span className="font-bold text-[#facc15]">Silhouette {data.silhouette?.toFixed(3)}:</span>{' '}
            {data.silhouette && data.silhouette > 0.5
              ? 'Good structural separation between clusters.'
              : 'Clusters overlap significantly — behaviour is homogeneous.'}
          </p>
          <p>
            <span className="font-bold text-[#facc15]">Centroid distance {data.centroid_distance.toFixed(3)}:</span>{' '}
            {data.centroid_distance > 3.0
              ? '🔴 Highly polarized discourse.'
              : data.centroid_distance < 1.0
                ? '⚠ Sentiment from network structure alone is unreliable — this is likely a one-sided mobilization.'
                : '🟡 Moderate polarization.'}
          </p>
          <p>
            <span className="font-bold text-[#facc15]">Polarization index {data.polarization_index.toFixed(2)}:</span>{' '}
            {data.polarization_index > 0.8
              ? `${Math.round(data.polarization_index * 100)}% of nodes are in extreme clusters — nearly everyone has taken a side.`
              : 'Moderate polarization with significant neutral observers.'}
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Disinformation View ────────────────────────────────────────────────────

const DisinfoView: React.FC<{ data: DisinfoData }> = ({ data }) => {
  const total = data.risk_distribution.clean + data.risk_distribution.suspicious + data.risk_distribution.likely_disinfo;
  const top10 = data.scores.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-red-400" />
        <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">
          5-Signal Composite Score
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Mean Score" value={data.score_stats.mean.toFixed(4)} accent="border-[#f59e0b]" />
        <StatCard title="Std Dev" value={data.score_stats.std.toFixed(4)} accent="border-[#3b82f6]" />
        <StatCard title="Max Score" value={data.score_stats.max.toFixed(4)} accent="border-[#ef4444]" />
        <StatCard title="Min Score" value={data.score_stats.min.toFixed(4)} accent="border-[#10b981]" />
      </div>

      {/* Risk distribution bars */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-4">Risk Distribution</h3>
        <div className="space-y-4">
          {([
            { key: 'clean', label: 'Clean', color: 'bg-green-500', count: data.risk_distribution.clean },
            { key: 'suspicious', label: 'Suspicious', color: 'bg-orange-500', count: data.risk_distribution.suspicious },
            { key: 'likely_disinfo', label: 'Likely Disinfo', color: 'bg-red-500', count: data.risk_distribution.likely_disinfo },
          ] as const).map(item => (
            <div key={item.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-bold">{item.label}</span>
                <span className="text-text-muted">{item.count} nodes ({Math.round(item.count / Math.max(total, 1) * 100)}%)</span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(item.count / Math.max(total, 1)) * 100}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className={`h-full rounded-full ${item.color}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 10 suspicious */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-4">Top 10 Most Suspicious Accounts</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted uppercase tracking-wider">
                <th className="text-left py-2 px-3">Account</th>
                <th className="text-right py-2 px-3">Score</th>
                <th className="text-right py-2 px-3">Retweet Amp</th>
                <th className="text-right py-2 px-3">Network Pos</th>
                <th className="text-right py-2 px-3">Echo Chamber</th>
                <th className="text-right py-2 px-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((s, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 px-3 font-bold text-white">@{s.node}</td>
                  <td className="py-2 px-3 text-right font-mono">{s.disinfo_score.toFixed(4)}</td>
                  <td className="py-2 px-3 text-right font-mono text-text-secondary">
                    {s.retweet_amplification?.toFixed(2) || '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-text-secondary">
                    {s.network_position_anomaly?.toFixed(2) || '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-text-secondary">
                    {s.echo_chamber_index?.toFixed(2) || '-'}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      s.risk_level === 'clean' ? 'bg-green-500/20 text-green-400' :
                      s.risk_level === 'suspicious' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {s.risk_level.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Signals reference */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-3">Signal Weights</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] text-text-secondary">
          <div className="bg-white/[0.02] p-3 rounded-lg"><span className="font-bold text-white">A1</span> Retweet Amp <span className="text-[#facc15]">0.25</span></div>
          <div className="bg-white/[0.02] p-3 rounded-lg"><span className="font-bold text-white">A2</span> Temporal Reg <span className="text-[#facc15]">0.15</span></div>
          <div className="bg-white/[0.02] p-3 rounded-lg"><span className="font-bold text-white">A3</span> Network Pos <span className="text-[#facc15]">0.30</span></div>
          <div className="bg-white/[0.02] p-3 rounded-lg"><span className="font-bold text-white">A4</span> Echo Chamber <span className="text-[#facc15]">0.15</span></div>
          <div className="bg-white/[0.02] p-3 rounded-lg"><span className="font-bold text-white">A5</span> Follower Sparse <span className="text-[#facc15]">0.15</span></div>
        </div>
      </div>
    </div>
  );
};

// ─── Hashtag View ───────────────────────────────────────────────────────────

const HashtagView: React.FC<{ data: HashtagData }> = ({ data }) => {
  const organicCount = data.authenticity.filter(h => h.label === 'Organic').length;
  const artificialCount = data.authenticity.filter(h => h.label === 'Artificial').length;

  if (data.hashtag_count === 0) {
    return (
      <div className="text-center py-10">
        <Hash size={40} className="text-text-muted mx-auto mb-4 opacity-30" />
        <p className="text-sm text-text-secondary">No hashtags detected in this dataset.</p>
        <p className="text-[10px] text-text-muted mt-2">Hashtag analysis requires tweet/post text content in the edges.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Hash size={14} className="text-[#3b82f6]" />
        <span className="text-[10px] font-black text-[#3b82f6] uppercase tracking-widest">
          Lifecycle + GMM Authenticity
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="Hashtags" value={data.hashtag_count.toString()} accent="border-[#3b82f6]" />
        <StatCard title="Organic" value={organicCount.toString()}
          subtitle={`${Math.round(organicCount / Math.max(data.authenticity.length, 1) * 100)}%`} accent="border-[#10b981]" />
        <StatCard title="Artificial" value={artificialCount.toString()}
          subtitle={`Ratio: ${data.artificial_ratio.toFixed(3)}`}
          accent={data.artificial_ratio > 0.4 ? 'border-[#ef4444]' : 'border-[#f59e0b]'} />
      </div>

      {/* Warning if high artificial ratio */}
      {data.artificial_ratio > 0.4 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400" />
          <div>
            <p className="text-xs font-bold text-red-400">Significant Artificial Amplification</p>
            <p className="text-[10px] text-text-secondary mt-1">
              {Math.round(data.artificial_ratio * 100)}% of hashtags flagged as artificially amplified.
              This may indicate coordinated inauthentic behavior.
            </p>
          </div>
        </div>
      )}

      {/* Authenticity table */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-4">Hashtag Authenticity (GMM)</h3>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0f172a]">
              <tr className="text-text-muted uppercase tracking-wider">
                <th className="text-left py-2 px-3">Hashtag</th>
                <th className="text-right py-2 px-3">Score</th>
                <th className="text-center py-2 px-3">Label</th>
                <th className="text-left py-2 px-3">Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {data.authenticity.map((h, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 px-3 font-bold text-white">#{h.hashtag}</td>
                  <td className="py-2 px-3 text-right font-mono">{h.score.toFixed(4)}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      h.label === 'Organic' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>{h.label}</span>
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{h.lifecycle_phase}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Censorship View ────────────────────────────────────────────────────────

const CensorshipView: React.FC<{ data: CensorshipData }> = ({ data }) => {
  const fragmentingCount = data.structural_holes.filter(h => h.is_fragmenting).length;
  const maxSI = data.structural_holes[0]?.si_score || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={14} className="text-[#ef4444]" />
        <span className="text-[10px] font-black text-[#ef4444] uppercase tracking-widest">
          Structural Hole Analysis
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard title="Fiedler λ₂" value={data.fiedler_value.toFixed(6)}
          subtitle={data.fiedler_value < 0.01 ? '🔴 Near-fragmentation' : data.fiedler_value < 0.1 ? '🟡 Loose' : '🟢 Robust'}
          accent={data.fiedler_value < 0.01 ? 'border-[#ef4444]' : data.fiedler_value < 0.1 ? 'border-[#f59e0b]' : 'border-[#10b981]'} />
        <StatCard title="CVI" value={data.cvi?.toFixed(4) || 'N/A'}
          subtitle={data.cvi && data.cvi > 100 ? 'Highly vulnerable' : data.cvi && data.cvi > 10 ? 'Moderate' : 'Resilient'}
          accent={data.cvi && data.cvi > 10 ? 'border-[#ef4444]' : 'border-[#10b981]'} />
        <StatCard title="Fragmenting" value={`${fragmentingCount} / ${data.structural_holes.length}`}
          subtitle="of top 20 would fragment" accent="border-[#8b5cf6]" />
      </div>

      {/* Warning if critical */}
      {data.fiedler_value < 0.01 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400" />
          <div>
            <p className="text-xs font-bold text-red-400">Network is one edge from fragmentation</p>
            <p className="text-[10px] text-text-secondary mt-1">
              The Fiedler value (algebraic connectivity) is near zero. Removing key bridge accounts would shatter the network into isolated components.
            </p>
          </div>
        </div>
      )}

      {/* Structural holes table */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-4">Top 20 Structural Holes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted uppercase tracking-wider">
                <th className="text-left py-2 px-3">Account</th>
                <th className="text-right py-2 px-3">SI Score</th>
                <th className="text-right py-2 px-3">Betweenness</th>
                <th className="text-right py-2 px-3">Degree</th>
                <th className="text-center py-2 px-3">Fragments?</th>
              </tr>
            </thead>
            <tbody>
              {data.structural_holes.map((h, i) => (
                <tr key={i} className={`border-t border-white/5 hover:bg-white/[0.02] ${h.is_fragmenting ? 'bg-red-500/5' : ''}`}>
                  <td className="py-2 px-3 font-bold text-white">
                    @{h.node}
                    {h.display_name && <span className="text-text-muted ml-2 text-[10px]">{h.display_name}</span>}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-[#facc15] rounded-full"
                          style={{ width: `${(h.si_score / Math.max(maxSI, 0.000001)) * 100}%` }} />
                      </div>
                      <span>{h.si_score.toFixed(6)}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-text-secondary">{h.betweenness.toFixed(6)}</td>
                  <td className="py-2 px-3 text-right font-mono text-text-secondary">{h.degree}</td>
                  <td className="py-2 px-3 text-center">
                    {h.is_fragmenting
                      ? <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">YES</span>
                      : <span className="text-[10px] text-text-muted">no</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology note */}
      <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
        <h3 className="text-sm font-bold tracking-tight mb-3">Methodology</h3>
        <div className="text-xs text-text-secondary space-y-1">
          <p><span className="font-bold text-[#facc15]">Structural Impact:</span> SI(v) = C_B(v) · log(deg(v) + 1)</p>
          <p><span className="font-bold text-[#facc15]">Censorship Vulnerability Index:</span> CVI = max(C_B) / λ₂(L)</p>
          <p><span className="font-bold text-[#facc15]">Fiedler value (λ₂):</span> Algebraic connectivity of the graph Laplacian. Near-zero → fragile.</p>
          <p className="mt-2 text-[10px] text-text-muted">
            A "fragmenting" node is one whose removal increases the number of connected components by more than 10%.
            These are the accounts most likely to be targeted for censorship.
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── Shared Components ──────────────────────────────────────────────────────

const StatCard = ({ title, value, subtitle, accent }: {
  title: string; value: string; subtitle?: string; accent: string;
}) => (
  <div className={`bg-[#0f172a]/30 border border-white/5 border-b-2 ${accent} rounded-2xl p-5 group hover:bg-[#0f172a]/50 transition-all cursor-default`}>
    <div className="flex justify-between items-start mb-4">
      <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">{title}</span>
    </div>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-black">{value}</span>
      {subtitle && <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">{subtitle}</span>}
    </div>
  </div>
);

const Legend = ({ color, label, count, total, detail }: {
  color: string; label: string; count: number; total: number; detail: string;
}) => (
  <div className="min-w-[200px]">
    <div className="flex items-center justify-between gap-8">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <span className="text-xs font-bold text-text-secondary">{label}</span>
      </div>
      <span className="text-xs font-black">{count} ({Math.round(count / Math.max(total, 1) * 100)}%)</span>
    </div>
    <p className="text-[9px] text-text-muted ml-6 mt-0.5">{detail}</p>
  </div>
);

export default PythonAnalysisTabs;
