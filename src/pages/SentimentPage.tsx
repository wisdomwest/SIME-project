import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { DataTable } from '../components/primitives/DataTable';
import { Chip } from '../components/primitives/Chip';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { SentimentData, getSentiment } from '../services/pythonApi';
import { useEffect, useState } from 'react';
import { Loader2, ArrowUpRight } from 'lucide-react';

export function SentimentPage() {
  return (
    <PythonOnlyWrap feature="sentiment clustering">
      <SentimentView />
    </PythonOnlyWrap>
  );
}

function SentimentView() {
  const { route, navigate } = useUrlState();
  const { pythonDatasetId, graphData } = useSocialData();
  const datasetId = pythonDatasetId ?? (route.name !== 'landing' && route.name !== 'docs' ? route.datasetId : '');
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSentiment(datasetId)
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [datasetId]);

  if (loading) {
    return (
      <div className="p-20 flex flex-col items-center gap-3">
        <Loader2 size={20} className="text-ember animate-spin" />
        <p className="text-sm text-ink-soft">Running k-means on 9-D network features…</p>
      </div>
    );
  }
  if (!data) return null;

  const total = data.clusters.Pos + data.clusters.Neu + data.clusters.Neg;
  const posPct = (data.clusters.Pos / Math.max(total, 1)) * 100;
  const neuPct = (data.clusters.Neu / Math.max(total, 1)) * 100;
  const negPct = (data.clusters.Neg / Math.max(total, 1)) * 100;

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Sentiment · K-means on 9-D features</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          Behavioral Cluster Analysis
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed">
          Each account is grouped with k-means++ on nine network dimensions (degree, betweenness,
          closeness, eigenvector, PageRank, clustering, reciprocity, follower ratio, influence).
          Clusters are then re-labelled: high out-degree + low reciprocity = Negative (broadcasters);
          high reciprocity + high betweenness = Positive (connectors); the rest = Neutral.
        </p>
      </header>

      <Panel padded={false}>
        <div className="p-6">
          <StatGrid>
            <StatBlock
              label="Silhouette"
              value={data.silhouette?.toFixed(3) ?? '—'}
              caption={data.silhouette && data.silhouette > 0.5 ? 'Good structural separation' : 'Fair/poor — clusters overlap'}
              emphasis={data.silhouette && data.silhouette > 0.5 ? 'pos' : 'ember'}
              explainer="Silhouette measures how well each point fits in its cluster vs the next-closest. >0.5 is good, <0.3 is poor. If silhouette is low, sentiment from network structure alone is unreliable."
            />
            <StatBlock
              label="Polarisation"
              value={data.polarization_index.toFixed(3)}
              caption={`${Math.round(data.polarization_index * 100)}% in extreme clusters`}
              emphasis={data.polarization_index > 0.8 ? 'neg' : 'ink'}
              explainer="Share of accounts in the Positive or Negative clusters (versus Neutral). High polarisation = few bystanders, everyone has taken a side."
            />
            <StatBlock
              label="Centroid distance"
              value={data.centroid_distance.toFixed(2)}
              caption={data.centroid_distance < 1 ? 'Unreliable — one-sided mobilisation' : 'Reliable separation'}
              emphasis={data.centroid_distance < 1 ? 'ember' : 'pos'}
              explainer="Euclidean distance between the Positive and Negative cluster centroids in normalised feature space. >3.0 = highly polarised; <1.0 = the structural signals can't tell the camps apart."
            />
            <StatBlock
              label="Total clustered"
              value={total.toLocaleString()}
              caption="All accounts in the dataset"
            />
          </StatGrid>
        </div>
      </Panel>

      <Panel
        eyebrow={<Eyebrow>Distribution</Eyebrow>}
        title="Sentiment composition"
        description="Stacked by node count. Negative accounts are typically the loudest and most active — they broadcast more than they receive — so even a small percentage can dominate the timeline."
      >
        <div className="space-y-4">
          <div className="flex h-10 w-full border border-rule overflow-hidden">
            <div className="bg-signal-pos flex items-center justify-center text-paper text-xs font-mono" style={{ width: `${posPct}%` }}>
              {posPct > 8 && `${Math.round(posPct)}%`}
            </div>
            <div className="bg-ink-soft flex items-center justify-center text-paper text-xs font-mono" style={{ width: `${neuPct}%` }}>
              {neuPct > 8 && `${Math.round(neuPct)}%`}
            </div>
            <div className="bg-signal-neg flex items-center justify-center text-paper text-xs font-mono" style={{ width: `${negPct}%` }}>
              {negPct > 8 && `${Math.round(negPct)}%`}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 pt-2">
            <Cluster label="Positive" tone="pos" count={data.clusters.Pos} total={total} body="High reciprocity + betweenness. Genuine connectors." />
            <Cluster label="Neutral" tone="neu" count={data.clusters.Neu} total={total} body="Balanced metrics. Observers and lurkers." />
            <Cluster label="Negative" tone="neg" count={data.clusters.Neg} total={total} body="High out-degree, low reciprocity. Broadcasters." />
          </div>
        </div>
      </Panel>

      {graphData && data.labels && (
        <Panel
          eyebrow={<Eyebrow>Sample</Eyebrow>}
          title="First 50 accounts and their cluster assignment"
        >
          <DataTable
            rowKey={(l) => l.node}
            dense
            onRowClick={(l) => {
              navigate({ name: 'account', datasetId: route.name === 'landing' || route.name === 'docs' ? 'default' : route.datasetId, nodeId: l.node });
            }}
            columns={[
              {
                key: 'node',
                header: 'Account',
                render: (l) => (
                  <div className="flex items-center gap-2">
                    <span className="text-ink">@{l.node}</span>
                    <Chip tone={l.sentiment === 'Pos' ? 'pos' : l.sentiment === 'Neg' ? 'neg' : 'neu'}>
                      {l.sentiment}
                    </Chip>
                  </div>
                ),
              },
              {
                key: 'click',
                header: '',
                align: 'right',
                render: () => <ArrowUpRight size={12} className="text-ink-mute" />,
              },
            ]}
            rows={data.labels.slice(0, 50)}
          />
        </Panel>
      )}
    </div>
  );
}

function Cluster({ label, tone, count, total, body }: { label: string; tone: 'pos' | 'neu' | 'neg'; count: number; total: number; body: string }) {
  const pct = (count / Math.max(total, 1)) * 100;
  const dot = tone === 'pos' ? 'bg-signal-pos' : tone === 'neg' ? 'bg-signal-neg' : 'bg-ink-soft';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className={`w-2.5 h-2.5 ${dot}`} />
          {label}
        </span>
        <span className="font-mono text-sm text-ink">{count.toLocaleString()}</span>
      </div>
      <p className="text-xs text-ink-soft leading-relaxed">{body}</p>
      <p className="text-[10px] text-ink-mute font-mono mt-1">{pct.toFixed(1)}% of network</p>
    </div>
  );
}
