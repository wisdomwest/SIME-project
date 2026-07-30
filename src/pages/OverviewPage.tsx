import { useMemo, useCallback } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { Chip } from '../components/primitives/Chip';
import { DataTable, Column } from '../components/primitives/DataTable';
import { Button } from '../components/primitives/Button';
import { NetworkGraph } from '../components/graph/NetworkGraph';
import { CampaignTimeline } from '../components/insights/CampaignTimeline';
import { formatNumber, initials, safeImgUrl, sentimentLabel, sentimentTone } from '../app/format';
import { ArrowUpRight } from 'lucide-react';
import { Vertex } from '../engine/csvParserEnhanced';

export function OverviewPage() {
  const { route, navigate, updateExtras } = useUrlState();
  const { graphData, computedMetrics, aiInsights, filteredData } = useSocialData();

  const datasetId = ('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string;
  const displayV = filteredData?.vertices || graphData?.vertices || [];
  const displayE = filteredData?.edges || graphData?.edges || [];

  const handleNodeSelect = useCallback((id: string) => {
    updateExtras({ selectedNode: id });
  }, [updateExtras]);

  const m = computedMetrics;
  const i = aiInsights;

  const topNodes = useMemo(() => {
    if (!graphData) return [];
    return [...graphData.vertices]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 12);
  }, [graphData]);

  const communityStats = useMemo(() => {
    if (!graphData) return [];
    const map = new Map<number, Vertex[]>();
    graphData.vertices.forEach((v) => {
      if (!map.has(v.cluster)) map.set(v.cluster, []);
      map.get(v.cluster)!.push(v);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([cid, members]) => {
        const top = [...members].sort((a, b) => b.degree - a.degree)[0];
        const sent = members.reduce(
          (acc, v) => {
            acc[v.sentiment] = (acc[v.sentiment] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const domSent = (Object.entries(sent).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Neu') as 'Pos' | 'Neu' | 'Neg';
        return { id: cid, size: members.length, top, domSent };
      });
  }, [graphData]);

  if (!m || !graphData) return null;

  const posPct = (m.sentimentDistribution.Pos / Math.max(m.totalVertices, 1)) * 100;
  const negPct = (m.sentimentDistribution.Neg / Math.max(m.totalVertices, 1)) * 100;
  const neuPct = 100 - posPct - negPct;

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      {/* HERO STRIP ────────────────────────────────────────────── */}
      <header className="space-y-4">
        <Eyebrow accent>
          {datasetId} · Report N°01 · {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        </Eyebrow>
        <h1
          className="font-display text-5xl text-ink font-light leading-[1.05] tracking-[-0.02em] max-w-3xl"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 100" }}
        >
          {m.totalVertices.toLocaleString()} accounts. {m.totalEdges.toLocaleString()} connections.{' '}
          <em className="text-ember not-italic">
            {m.connectedComponents === 1 ? 'One conversation.' : 'Fragmented conversation.'}
          </em>
        </h1>
        <p className="text-base text-ink-soft leading-relaxed max-w-2xl">
          {m.connectedComponents} community cluster{m.connectedComponents !== 1 ? 's' : ''}, a density of {m.density.toFixed(4)}, and{' '}
          {(m.reciprocity * 100).toFixed(2)}% reciprocal edges. The conversation skews{' '}
          <span className="text-signal-pos font-medium">{Math.round(posPct)}% positive</span>,{' '}
          <span className="text-signal-neg font-medium">{Math.round(negPct)}% negative</span>, and{' '}
          <span className="text-ink-soft font-medium">{Math.round(neuPct)}% neutral</span>.
        </p>
      </header>

      {/* STAT GRID ─────────────────────────────────────────────── */}
      <Panel padded={false}>
        <div className="p-6">
          <StatGrid>
            <StatBlock
              label="Accounts"
              value={m.totalVertices.toLocaleString()}
              spark={m.topInfluencers.slice(0, 10).map((v) => v.degree)}
              explainer="Unique accounts (vertices) in the network. Equal to the number of Twitter handles, Facebook pages, or authors across all edges."
            />
            <StatBlock
              label="Connections"
              value={m.totalEdges.toLocaleString()}
              explainer="Directed edges between accounts — retweets, mentions, replies, and follows. Direction encodes the source → target of the interaction."
            />
            <StatBlock
              label="Density"
              value={m.density.toFixed(4)}
              explainer="The ratio of actual edges to all possible edges. A density of 0.01 means only 1% of possible connections are present. Sparse networks are typical of organic conversations."
              emphasis="ember"
            />
            <StatBlock
              label="Components"
              value={m.connectedComponents.toLocaleString()}
              explainer="Number of disconnected sub-graphs. One component = everyone is reachable from everyone. Many components = fragmented conversation."
            />
            <StatBlock
              label="Reciprocity"
              value={`${(m.reciprocity * 100).toFixed(2)}%`}
              explainer="Share of edges where the reverse edge also exists (A→B and B→A). Higher reciprocity means dialogue; lower means broadcast."
            />
            <StatBlock
              label="Suspicious"
              value={i ? `${Math.round(i.botActivityScore * 100)}%` : '—'}
              explainer="Share of accounts whose bot-likelihood score crosses the 0.5 threshold, based on five structural signals."
              emphasis={i && i.botActivityScore > 0.2 ? 'neg' : 'ink'}
            />
          </StatGrid>
        </div>
      </Panel>

      {/* CAMPAIGN SIGNALS + GRAPH ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <Panel
            eyebrow={<Eyebrow accent>Network</Eyebrow>}
            title="Social Network Visualization"
            description="Force-directed graph of the loaded dataset. Node size reflects degree; color reflects Louvain community. Click any node to open its deep-dive drawer."
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'network', datasetId })}>
                Open full graph <ArrowUpRight size={12} />
              </Button>
            }
          >
            <div className="h-[460px] -mx-2">
              <NetworkGraph
                vertices={graphData.vertices}
                edges={graphData.edges}
                filteredVertices={displayV}
                filteredEdges={displayE}
                onNodeSelect={handleNodeSelect}
                isActive
                compact
              />
            </div>
          </Panel>

          <Panel
            eyebrow={<Eyebrow>Top accounts</Eyebrow>}
            title="By degree centrality"
            description="Most-connected accounts in the network. Click any to open the deep-dive drawer with full metrics, posting timeline, and related accounts."
          >
            <DataTable
              rowKey={(v) => v.id}
              onRowClick={(v) => navigate({ name: 'account', datasetId, nodeId: v.id })}
              dense
              columns={topColumns()}
              rows={topNodes}
            />
          </Panel>
        </div>

        <aside className="lg:col-span-4 space-y-6">
          {i && (
            <Panel
              eyebrow={<Eyebrow accent>Campaign signals</Eyebrow>}
              title="Coordinated Behavior & Timeline Analysis"
            >
              <CampaignTimeline insights={i} />
            </Panel>
          )}

          <Panel
            eyebrow={<Eyebrow>Communities</Eyebrow>}
            title="Top clusters"
          >
            <div className="space-y-3">
              {communityStats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate({ name: 'overview', datasetId })}
                  className="w-full text-left flex items-center gap-3 group hover:bg-paper-2 p-2 -mx-2 transition-colors"
                >
                  <span className="font-mono text-[10px] text-ink-mute w-12">C{c.id + 1}</span>
                  <span className="flex-1 truncate text-sm text-ink">
                    @{c.top?.label || '—'}
                  </span>
                  <Chip tone={sentimentTone(c.domSent) === 'pos' ? 'pos' : sentimentTone(c.domSent) === 'neg' ? 'neg' : 'neu'}>
                    {sentimentLabel(c.domSent)}
                  </Chip>
                  <span className="font-mono text-xs text-ink-mute">{c.size}</span>
                </button>
              ))}
            </div>
          </Panel>

          {i && i.hashtagTrends.length > 0 && (
            <Panel eyebrow={<Eyebrow>Hashtags</Eyebrow>} title="Trending in this conversation">
              <div className="flex flex-wrap gap-1.5">
                {i.hashtagTrends.slice(0, 12).map((h) => (
                  <span
                    key={h.hashtag}
                    className="px-2 py-1 text-xs font-mono border border-rule hover:border-ember hover:text-ember transition-colors cursor-default"
                    style={{ fontSize: `${Math.max(11, Math.min(15, 11 + h.count / 5))}px` }}
                  >
                    #{h.hashtag}
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function topColumns(): Column<Vertex>[] {
  return [
    {
      key: 'rank',
      header: '#',
      width: '32px',
      render: (_v, i) => <span className="font-mono text-[10px] text-ink-mute">{String(i + 1).padStart(2, '0')}</span>,
    },
    {
      key: 'account',
      header: 'Account',
      render: (v) => {
        const src = safeImgUrl(v.image_url);
        return (
          <div className="flex items-center gap-2 min-w-0">
            {src ? (
              <img src={src} alt="" className="w-6 h-6 rounded-full object-cover border border-rule" />
            ) : (
              <span className="w-6 h-6 rounded-full bg-paper-3 border border-rule flex items-center justify-center text-[10px] font-mono text-ink-soft">
                {initials(v.label)}
              </span>
            )}
            <span className="text-ink truncate">@{v.label}</span>
                  <Chip tone={sentimentTone(v.sentiment)}>{sentimentLabel(v.sentiment)}</Chip>
          </div>
        );
      },
      sortValue: (v) => v.degree,
    },
    {
      key: 'deg',
      header: 'Deg',
      align: 'right',
      width: '56px',
      render: (v) => <span className="font-mono text-xs text-ink">{v.degree}</span>,
      sortValue: (v) => v.degree,
    },
    {
      key: 'pr',
      header: 'PR',
      align: 'right',
      width: '72px',
      render: (v) => <span className="font-mono text-xs text-ink-soft">{v.pagerank.toFixed(3)}</span>,
      sortValue: (v) => v.pagerank,
    },
    {
      key: 'bc',
      header: 'BC',
      align: 'right',
      width: '72px',
      render: (v) => <span className="font-mono text-xs text-ink-soft">{v.betweenness.toFixed(4)}</span>,
      sortValue: (v) => v.betweenness,
    },
    {
      key: 'fol',
      header: 'Followers',
      align: 'right',
      width: '80px',
      render: (v) => <span className="font-mono text-xs text-ink-soft">{formatNumber(v.followers)}</span>,
      sortValue: (v) => v.followers,
    },
  ];
}
