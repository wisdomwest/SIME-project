import { useMemo } from 'react';
import { useSocialData } from '../../hooks/useSocialData';
import { useUrlState } from '../../app/useUrlState';
import { Eyebrow } from '../primitives/Eyebrow';
import { Panel } from '../primitives/Panel';
import { Drawer } from '../primitives/Drawer';
import { Chip } from '../primitives/Chip';
import { Explainer } from '../primitives/StatBlock';
import { Button } from '../primitives/Button';
import { formatDate, formatDateISO, formatNumber, initials, parseDate, relativeDate, safeImgUrl, sentimentTone } from '../../app/format';
import { ArrowUpRight } from 'lucide-react';
import { Vertex } from '../../engine/csvParserEnhanced';

export function AccountDrawer() {
  const { route, navigate } = useUrlState();
  const { graphData, computedMetrics, aiInsights } = useSocialData();
  const isAccount = route.name === 'account';
  const nodeId = isAccount ? route.nodeId : null;
  const datasetId = route.name !== 'landing' && route.name !== 'docs' ? route.datasetId : null;

  const vertex = useMemo<Vertex | null>(() => {
    if (!graphData || !nodeId) return null;
    return graphData.vertices.find((v) => v.id === nodeId) || null;
  }, [graphData, nodeId]);

  function close() {
    if (route.name === 'account') {
      navigate({ name: 'overview', datasetId: route.datasetId });
    }
  }

  if (!vertex) {
    return (
      <Drawer open={isAccount} onClose={close} title="Account">
        <p className="text-sm text-ink-soft">
          No account matching <span className="font-mono text-ember">{nodeId}</span> in the loaded dataset.
        </p>
      </Drawer>
    );
  }

  return (
    <Drawer open={isAccount} onClose={close} title="Account deep-dive">
      <AccountBody vertex={vertex} datasetId={(datasetId ?? '')} navigate={navigate} computedMetrics={computedMetrics} aiInsights={aiInsights} />
    </Drawer>
  );
}

function MetricBlock({ label, value, explainer }: { label: string; value: string; explainer?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-mute truncate">{label}</span>
        {explainer && <Explainer text={explainer} />}
      </div>
      <span
        className="font-display text-2xl text-ink font-light leading-none"
        style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 100" }}
      >
        {value}
      </span>
    </div>
  );
}

function AccountBody({ vertex, datasetId, navigate, computedMetrics, aiInsights }: { vertex: Vertex; datasetId: string; navigate: ReturnType<typeof useUrlState>['navigate']; computedMetrics: ReturnType<typeof useSocialData>['computedMetrics']; aiInsights: ReturnType<typeof useSocialData>['aiInsights'] }) {
  const avatar = safeImgUrl(vertex.image_url);

  // Find related accounts by co-occurrence in edges.
  const { graphData } = useSocialData();
  const related = useMemo(() => {
    if (!graphData) return [] as { id: string; count: number }[];
    const counts = new Map<string, number>();
    graphData.edges.forEach((e) => {
      if (e.source === vertex.id) counts.set(e.target, (counts.get(e.target) || 0) + 1);
      else if (e.target === vertex.id) counts.set(e.source, (counts.get(e.source) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => ({ id, count }));
  }, [graphData, vertex.id]);

  // Posting timeline — group by day
  const timeline = useMemo(() => {
    if (!graphData) return [] as { day: string; count: number }[];
    const days = new Map<string, number>();
    graphData.edges.forEach((e) => {
      if (e.source !== vertex.id && e.target !== vertex.id) return;
      const parsed = parseDate(e.date);
      if (!parsed) return;
      const d = formatDateISO(parsed);
      days.set(d, (days.get(d) || 0) + 1);
    });
    return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));
  }, [graphData, vertex.id]);

  // 7x24 heatmap
  const heatmap = useMemo(() => {
    if (!graphData) return [] as number[][];
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    graphData.edges.forEach((e) => {
      if (e.source !== vertex.id && e.target !== vertex.id) return;
      const d = parseDate(e.date);
      if (!d) return;
      grid[d.getUTCDay()][d.getUTCHours()]++;
    });
    return grid;
  }, [graphData, vertex.id]);

  const maxHeat = Math.max(1, ...heatmap.flat());
  const maxTimeline = Math.max(1, ...timeline.map((t) => t.count));

  // The bot signal from AI insights
  const botSignal = aiInsights?.suspiciousAccounts.find((a) => a.id === vertex.id);

  // Build per-day series for sparkline of degree over time? (Skip — use simpler)
  void computedMetrics;

  return (
    <div className="space-y-7">
      {/* Identity */}
      <header className="flex items-start gap-4">
        {avatar ? (
          <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover border border-rule" />
        ) : (
          <span className="w-16 h-16 rounded-full bg-paper-3 border border-rule flex items-center justify-center font-display text-xl text-ink-soft" style={{ fontVariationSettings: "'opsz' 72, 'SOFT' 100" }}>
            {initials(vertex.label)}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h1
            className="font-display text-2xl text-ink font-light tracking-[-0.01em] truncate"
            style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 100" }}
          >
            @{vertex.label}
          </h1>
          <p className="text-xs text-ink-soft mt-1">
            {vertex.date ? `Joined ${formatDate(vertex.date)} · ${relativeDate(vertex.date)}` : 'Join date unknown'}
            {vertex.followers > 0 && ` · ${formatNumber(vertex.followers)} followers`}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Chip tone={sentimentTone(vertex.sentiment)}>{vertex.sentiment}</Chip>
            <Chip tone={vertex.isBot ? 'neg' : 'pos'}>{vertex.isBot ? `Bot (${Math.round(vertex.botScore * 100)}%)` : 'Organic'}</Chip>
            {vertex.cluster >= 0 && <Chip tone="ghost">C{vertex.cluster + 1}</Chip>}
          </div>
        </div>
      </header>

      {/* Tweet */}
      {vertex.tweetText && (
        <Panel padded>
          <Eyebrow>Sample post</Eyebrow>
          <p className="font-body text-sm text-ink leading-relaxed mt-2 italic border-l-2 border-ember pl-3">
            "{vertex.tweetText}"
          </p>
        </Panel>
      )}

      {/* Metrics */}
      <Panel padded={false}>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-y-4 gap-x-6">
            <MetricBlock
              label="Degree"
              value={vertex.degree.toString()}
              explainer="Total number of connections (in + out)."
            />
            <MetricBlock
              label="In-degree"
              value={vertex.inDegree.toString()}
              explainer="Number of accounts that mention, retweet, or reply to this one."
            />
            <MetricBlock
              label="Out-degree"
              value={vertex.outDegree.toString()}
              explainer="Number of accounts this one mentions, retweets, or replies to."
            />
            <MetricBlock
              label="Betweenness"
              value={vertex.betweenness.toFixed(4)}
              explainer="Fraction of shortest paths in the network that pass through this node. Higher = more bridging."
            />
            <MetricBlock
              label="PageRank"
              value={vertex.pagerank.toFixed(4)}
              explainer="Iterative authority score. An account is high-PageRank if it is mentioned by other high-PageRank accounts."
            />
            <MetricBlock
              label="Clustering"
              value={vertex.clusteringCoefficient.toFixed(3)}
              explainer="Watts-Strogatz local clustering coefficient — fraction of this account's neighbours that are also connected to each other."
            />
          </div>
        </div>
      </Panel>

      {/* Posting timeline */}
      {timeline.length > 0 && (
        <Panel eyebrow={<Eyebrow>Activity</Eyebrow>} title="Posts per day">
          <div className="flex items-end gap-px h-16 border-b border-rule">
            {timeline.map((t) => (
              <div
                key={t.day}
                className="flex-1 bg-ember hover:bg-ember-strong transition-colors"
                style={{ height: `${(t.count / maxTimeline) * 100}%`, minHeight: '2px' }}
                title={`${t.day} · ${t.count} posts`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-ink-mute mt-1.5">
            <span>{timeline[0]?.day}</span>
            <span>{timeline[timeline.length - 1]?.day}</span>
          </div>
        </Panel>
      )}

      {/* Heatmap */}
      {heatmap.some((row) => row.some((c) => c > 0)) && (
        <Panel eyebrow={<Eyebrow>Activity pattern</Eyebrow>} title="Day × hour (UTC)">
          <div className="space-y-2">
            <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-px text-[8px] font-mono text-ink-mute">
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center">{h % 6 === 0 ? h : ''}</div>
              ))}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => (
                <>
                  <div key={`l-${d}`} className="pr-1 text-right">{d}</div>
                  {heatmap[di].map((v, hi) => (
                    <div
                      key={`c-${di}-${hi}`}
                      className="aspect-square"
                      style={{ backgroundColor: `rgba(194, 65, 12, ${v / maxHeat})` }}
                      title={`${d} ${hi}:00 UTC · ${v} posts`}
                    />
                  ))}
                </>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {/* Hashtags */}
      {vertex.hashtags.length > 0 && (
        <Panel eyebrow={<Eyebrow>Hashtags</Eyebrow>} title="In this account's posts">
          <div className="flex flex-wrap gap-1.5">
            {vertex.hashtags.map((h) => (
              <span key={h} className="px-2 py-1 text-xs font-mono border border-rule hover:border-ember hover:text-ember transition-colors">
                #{h}
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* Related accounts */}
      {related.length > 0 && (
        <Panel eyebrow={<Eyebrow>Related</Eyebrow>} title="Most-connected peers">
          <ul className="space-y-1.5">
            {related.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => navigate({ name: 'account', datasetId, nodeId: r.id })}
                  className="w-full flex items-center gap-3 text-left py-1 hover:text-ember transition-colors"
                >
                  <span className="text-sm text-ink">@{r.id}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink-mute">{r.count} edges</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Bot signal */}
      {botSignal && (
        <Panel eyebrow={<Eyebrow accent>Suspicion</Eyebrow>} title="Why this account was flagged">
          <ul className="space-y-1.5 text-sm text-ink-soft">
            {botSignal.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-ember mt-1">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Cross-links */}
      <Panel eyebrow={<Eyebrow>Cross-reference</Eyebrow>} title="See in other analyses">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'disinfo', datasetId })}>
            Disinfo score <ArrowUpRight size={11} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'censorship', datasetId })}>
            Censorship view <ArrowUpRight size={11} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'sentiment', datasetId })}>
            Sentiment cluster <ArrowUpRight size={11} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'network', datasetId })}>
            Back to graph <ArrowUpRight size={11} />
          </Button>
        </div>
      </Panel>
    </div>
  );
}
