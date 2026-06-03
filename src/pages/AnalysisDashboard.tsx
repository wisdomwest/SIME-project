import React, { useState } from 'react';
import {
  LayoutDashboard, Share2, FileText,
  Brain, MessageSquare, Zap
} from 'lucide-react';
import type { Vertex, ComputedMetrics } from '../engine/engineTypes';
import type { GraphData } from '../engine/csvParserEnhanced';
import NetworkGraph from '../components/NetworkGraph';
import AIInsightsPanel from '../components/AIInsightsPanel';
import ChatPanel from '../components/ChatPanel';
import PythonAnalysisTabs from '../components/PythonAnalysisTabs';
import { AIInsights } from '../engine/aiInsights';
import simelogo from '../../simelogo.jpeg';

interface AnalysisDashboardProps {
  graphData: GraphData;
  computedMetrics: ComputedMetrics;
  aiInsights: AIInsights | null;
  filteredData: { vertices: Vertex[]; edges: import('../engine/csvParserEnhanced').Edge[] } | null;
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({
  graphData, computedMetrics, aiInsights, filteredData
}) => {
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [pySubTab, setPySubTab] = useState('pysentiment');

  const displayV: Vertex[] = filteredData?.vertices || graphData.vertices;
  const displayE = filteredData?.edges || graphData.edges;
  const m = computedMetrics;

  const selectedVertex = selectedNode ? displayV.find((v: Vertex) => v.id === selectedNode) : null;

  const tabs = [
    { id: 'Overview', icon: LayoutDashboard },
    { id: 'Network Graph', icon: Share2 },
    { id: 'AI Insights', icon: Brain },
    { id: 'Chat', icon: MessageSquare },
    { id: 'Python Analysis', icon: Zap },
    { id: 'Report', icon: FileText },
  ];

  return (
    <div className="w-full min-h-screen bg-[#050a14] text-white p-6 pb-20 font-inter">
      {/* === TOP STATS ROW === */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard title="Vertices" value={m.totalVertices.toString()} accent="border-[#facc15]" />
        <StatCard title="Edges" value={m.totalEdges.toString()} accent="border-[#3b82f6]" />
        <StatCard title="Density" value={m.density.toFixed(4)} accent="border-[#10b981]" />
        <StatCard title="Avg Degree" value={m.avgDegree.toFixed(1)} accent="border-[#f59e0b]" />
        <StatCard title="Components" value={m.connectedComponents.toString()} accent="border-[#8b5cf6]" />
        <StatCard title="Reciprocity" value={`${(m.reciprocity * 100).toFixed(1)}%`} accent="border-[#ec4899]" />
      </div>

      {/* === SECOND STATS ROW === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Network Diameter"
          value={m.diameter.toString()}
          accent="border-[#06b6d4]"
          subtitle="longest shortest path"
        />
        <StatCard
          title="Avg Clustering"
          value={m.avgClusteringCoefficient.toFixed(4)}
          accent="border-[#84cc16]"
          subtitle="Watts-Strogatz"
        />
        <StatCard
          title="Positive Sentiment"
          value={`${Math.round((m.sentimentDistribution.Pos / Math.max(m.totalVertices, 1)) * 100)}%`}
          accent="border-[#10b981]"
          subtitle={`${m.sentimentDistribution.Pos} nodes`}
        />
        <StatCard
          title="Suspicious Activity"
          value={aiInsights ? `${Math.round(aiInsights.botActivityScore * 100)}%` : 'N/A'}
          accent="border-[#ef4444]"
          subtitle={aiInsights ? `${aiInsights.suspiciousAccounts.length} flagged` : ''}
        />
      </div>

      {/* === TAB NAVIGATION === */}
      <div className="bg-[#0f172a]/50 border border-white/5 rounded-xl p-1 mb-8 flex gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === tab.id
              ? 'bg-[#facc15] text-[#050a14]'
              : 'text-text-secondary hover:bg-white/5'
              }`}
          >
            <tab.icon size={16} />
            {tab.id}
          </button>
        ))}
      </div>

      {/* === TAB CONTENT === */}

      {/* OVERVIEW TAB */}
      {activeTab === 'Overview' && (
        <div className="space-y-6">
          {/* Network graph preview */}
          <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl overflow-hidden" style={{ height: '450px' }}>
            <NetworkGraph vertices={displayV} edges={displayE} onNodeSelect={setSelectedNode} isActive={activeTab === 'Overview'} />
          </div>

          {/* Top influencers + Top betweenness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
              <h3 className="text-sm font-bold tracking-tight mb-4">Top 10 by Degree Centrality</h3>
              <div className="space-y-1">
                {m.topInfluencers.slice(0, 10).map((v, i) => (
                  <div key={v.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => { setSelectedNode(v.id); setActiveTab('Network Graph'); }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-text-muted w-5">#{i + 1}</span>
                      <span className="text-xs font-bold text-white">@{v.label}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${v.sentiment === 'Pos' ? 'bg-green-500/20 text-green-400' :
                        v.sentiment === 'Neg' ? 'bg-red-500/20 text-red-400' : 'bg-slate-500/20 text-slate-400'
                        }`}>{v.sentiment}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] text-text-muted">Deg: {v.degree}</span>
                      <span className="text-[10px] text-text-muted">PR: {v.pagerank.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
              <h3 className="text-sm font-bold tracking-tight mb-4">Top 10 by Betweenness (Bridges)</h3>
              <div className="space-y-1">
                {m.topBetweenness.slice(0, 10).map((v, i) => (
                  <div key={v.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => { setSelectedNode(v.id); setActiveTab('Network Graph'); }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-text-muted w-5">#{i + 1}</span>
                      <span className="text-xs font-bold text-white">@{v.label}</span>
                      {v.cluster >= 0 && (
                        <span className="text-[9px] text-text-muted bg-white/5 px-1.5 py-0.5 rounded">
                          C{v.cluster + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] text-text-muted">BC: {v.betweenness.toFixed(4)}</span>
                      <span className="text-[10px] text-text-muted">CC: {v.clusteringCoefficient.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Community breakdown */}
          {(() => {
            const clusters = new Map<number, Vertex[]>();
            displayV.forEach(v => {
              if (!clusters.has(v.cluster)) clusters.set(v.cluster, []);
              clusters.get(v.cluster)!.push(v);
            });
            return (
              <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
                <h3 className="text-sm font-bold tracking-tight mb-4">
                  Community Detection (Louvain) — {clusters.size} Communities
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[...clusters.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .slice(0, 9)
                    .map(([cid, members]) => {
                      const topMember = [...members].sort((a, b) => b.degree - a.degree)[0];
                      const posRatio = members.filter(v => v.sentiment === 'Pos').length / members.length;
                      return (
                        <div key={cid} className="p-4 bg-white/[0.02] rounded-xl border border-white/5 hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full" style={{
                              backgroundColor: ['#facc15', '#3b82f6', '#10b981', '#f43f5e', '#8b5cf6',
                                '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'][cid % 9]
                            }} />
                            <span className="text-xs font-bold text-white">Community {cid + 1}</span>
                          </div>
                          <p className="text-[10px] text-text-muted mb-1">{members.length} nodes</p>
                          <p className="text-[10px] text-text-muted mb-1">
                            Top: <span className="text-white">@{topMember?.label || '?'}</span>
                          </p>
                          <div className="w-full h-1.5 bg-white/5 rounded-full mt-2 overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.round(posRatio * 100)}%` }} />
                          </div>
                          <p className="text-[9px] text-text-muted mt-1">{Math.round(posRatio * 100)}% positive</p>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })()}

          {/* Selected node detail */}
          {selectedVertex && (
            <div className="bg-[#0f172a]/30 border border-[#facc15]/20 rounded-2xl p-6">
              <h3 className="text-sm font-bold tracking-tight mb-4">
                Node Detail: <span className="text-[#facc15]">@{selectedVertex.label}</span>
              </h3>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-center">
                <MetricBadge label="Degree" value={selectedVertex.degree.toString()} />
                <MetricBadge label="In-Degree" value={selectedVertex.inDegree.toString()} />
                <MetricBadge label="Out-Degree" value={selectedVertex.outDegree.toString()} />
                <MetricBadge label="Betweenness" value={selectedVertex.betweenness.toFixed(4)} />
                <MetricBadge label="PageRank" value={selectedVertex.pagerank.toFixed(4)} />
                <MetricBadge label="Clustering" value={selectedVertex.clusteringCoefficient.toFixed(3)} />
                <MetricBadge label="Eigenvector" value={selectedVertex.eigenvector.toFixed(4)} />
                <MetricBadge label="Closeness" value={selectedVertex.closeness.toFixed(4)} />
                <MetricBadge label="Followers" value={selectedVertex.followers.toLocaleString()} />
                <MetricBadge label="Sentiment" value={selectedVertex.sentiment} />
                <MetricBadge label="Community" value={`C${selectedVertex.cluster + 1}`} />
                <MetricBadge label="Bot Score" value={`${Math.round(selectedVertex.botScore * 100)}%`} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* NETWORK GRAPH TAB */}
      {activeTab === 'Network Graph' && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl overflow-hidden" style={{ height: 'calc(100vh - 300px)', minHeight: '500px' }}>
          <NetworkGraph vertices={displayV} edges={displayE} onNodeSelect={setSelectedNode} isActive={activeTab === 'Network Graph'} />
        </div>
      )}

      {/* AI INSIGHTS TAB */}
      {activeTab === 'AI Insights' && (
        <AIInsightsPanel
          insights={aiInsights}
          computedMetrics={computedMetrics}
        />
      )}

      {/* CHAT TAB — always mounted to preserve messages */}
      <div style={{ display: activeTab === 'Chat' ? 'block' : 'none' }}>
        <ChatPanel
          graphData={graphData}
          computedMetrics={computedMetrics}
          aiInsights={aiInsights}
        />
      </div>

      {/* PYTHON ANALYSIS TAB */}
      {activeTab === 'Python Analysis' && (
        <PythonAnalysisTabs
          activeTab={pySubTab}
          onTabChange={setPySubTab}
        />
      )}

      {/* REPORT TAB */}
      {activeTab === 'Report' && (
        <div className="bg-[#0f172a]/30 border border-white/5 rounded-2xl p-6">
          <h3 className="text-sm font-bold tracking-tight mb-4">Analysis Report</h3>
          <div className="prose prose-invert max-w-none">
            <div className="bg-[#050a14] rounded-xl p-6 border border-white/5 font-mono text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
              {`=== SIMElab Data Explorer — Network Analysis Report ===

NETWORK OVERVIEW
  Vertices:        ${m.totalVertices}
  Edges:           ${m.totalEdges}
  Density:         ${m.density.toFixed(4)}
  Diameter:        ${m.diameter}
  Connected Comps: ${m.connectedComponents}
  Reciprocity:     ${(m.reciprocity * 100).toFixed(1)}%
  Avg Degree:      ${m.avgDegree.toFixed(1)}
  Avg Clustering:  ${m.avgClusteringCoefficient.toFixed(4)}

SENTIMENT DISTRIBUTION
  Positive: ${m.sentimentDistribution.Pos} (${Math.round(m.sentimentDistribution.Pos / Math.max(m.totalVertices, 1) * 100)}%)
  Neutral:  ${m.sentimentDistribution.Neu} (${Math.round(m.sentimentDistribution.Neu / Math.max(m.totalVertices, 1) * 100)}%)
  Negative: ${m.sentimentDistribution.Neg} (${Math.round(m.sentimentDistribution.Neg / Math.max(m.totalVertices, 1) * 100)}%)

TOP 5 ACCOUNTS BY DEGREE
${m.topInfluencers.slice(0, 5).map((v, i) => `  ${i + 1}. @${v.label} — Degree: ${v.degree}, PageRank: ${v.pagerank.toFixed(4)}, Sentiment: ${v.sentiment}`).join('\n')}

TOP 5 BRIDGE ACCOUNTS (BETWEENNESS)
${m.topBetweenness.slice(0, 5).map((v, i) => `  ${i + 1}. @${v.label} — Betweenness: ${v.betweenness.toFixed(4)}, Cluster: C${v.cluster + 1}`).join('\n')}

AI INSIGHTS${aiInsights ? `
  ${aiInsights.summary}

  Bot Activity Score: ${Math.round(aiInsights.botActivityScore * 100)}%
  Polarization Index: ${Math.round(aiInsights.polarizationIndex * 100)}%
  Suspicious Accounts: ${aiInsights.suspiciousAccounts.length}
` : '\n  AI insights available after analysis.'}

=== Generated by SIMElab Data Explorer v5.0 ===`}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-20 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 opacity-40">
          <img src={simelogo} alt="SIME Logo" className="w-6 h-6 rounded object-cover" />
          <p className="text-sm text-text-muted font-black uppercase tracking-[0.4em]">
            SIMElab Data Explorer
          </p>
        </div>
      </footer>
    </div>
  );
};

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

const MetricBadge = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
    <p className="text-[9px] font-bold text-text-muted uppercase mb-1">{label}</p>
    <p className="text-sm font-black text-white">{value}</p>
  </div>
);

export default AnalysisDashboard;
