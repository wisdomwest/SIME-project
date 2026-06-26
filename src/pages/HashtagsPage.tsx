import { useEffect, useState, useCallback } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { HashtagData, getHashtags } from '../services/pythonApi';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { DataTable } from '../components/primitives/DataTable';
import { Chip } from '../components/primitives/Chip';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { Loader2, AlertTriangle } from 'lucide-react';

export function HashtagsPage() {
  return (
    <PythonOnlyWrap feature="hashtag analysis">
      <HashtagsView />
    </PythonOnlyWrap>
  );
}

function HashtagsView() {
  const { route, navigate } = useUrlState();
  const { pythonDatasetId } = useSocialData();
  const routeDataset = ('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string;
  const datasetId = pythonDatasetId ?? routeDataset;
  const [data, setData] = useState<HashtagData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    getHashtags(datasetId)
      .then(setData)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch hashtag analysis.');
      })
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-20 flex flex-col items-center gap-3">
        <Loader2 size={20} className="text-ember animate-spin" />
        <p className="text-sm text-ink-soft">Detecting lifecycle and GMM authenticity…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-6">
        <div className="border border-signal-neg bg-signal-neg-soft p-6 flex items-start gap-4">
          <AlertTriangle size={24} className="text-signal-neg shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Failed to load analysis</h3>
            <p className="text-xs text-ink-soft leading-relaxed">{error}</p>
            <button
              onClick={loadData}
              className="mt-2 text-xs font-medium text-ink border border-rule hover:border-ink px-3 py-1.5 hover:bg-paper-2 transition-colors cursor-pointer"
            >
              Retry request
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;
  if (data.hashtag_count === 0) {
    return (
      <div className="max-w-xl mx-auto my-20 text-center space-y-4">
        <Eyebrow>Hashtags</Eyebrow>
        <h2
          className="font-display text-3xl text-ink font-light"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          No hashtags found
        </h2>
        <p className="text-sm text-ink-soft">
          Hashtag analysis requires tweet/post text. The Edges sheet in your export must contain a column
          labelled <code className="font-mono">Tweet</code>, <code className="font-mono">Text</code>,{' '}
          <code className="font-mono">Content</code>, or <code className="font-mono">Tooltip</code>.
        </p>
      </div>
    );
  }

  const organic = data.authenticity.filter((h) => h.label === 'Organic').length;
  const artificial = data.authenticity.filter((h) => h.label === 'Artificial').length;
  const phaseCounts: Record<string, number> = {};
  Object.values(data.lifecycle).forEach((p) => {
    phaseCounts[p] = (phaseCounts[p] || 0) + 1;
  });

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Hashtags · Lifecycle + GMM</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          Hashtag Authenticity and Lifecycle Assessment
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed">
          Each hashtag is scored along a seven-feature legitimacy vector and assigned to a two-component
          Gaussian mixture: <em>Organic</em> or <em>Artificial</em>. Lifecycle phase is detected from the
          temporal volume distribution across the campaign.
        </p>
      </header>

      <Panel padded={false}>
        <div className="p-6">
          <StatGrid>
            <StatBlock label="Hashtags" value={data.hashtag_count.toLocaleString()} explainer="Unique hashtag strings extracted from tweet/post text and node descriptions." />
            <StatBlock label="Organic" value={organic.toLocaleString()} emphasis="pos" caption={`${((organic / Math.max(data.authenticity.length, 1)) * 100).toFixed(0)}% of scored`} explainer="Tags whose legitimacy features cluster with verified authors, varied hashtags, and long account histories." />
            <StatBlock label="Artificial" value={artificial.toLocaleString()} emphasis={data.artificial_ratio > 0.4 ? 'neg' : 'warn'} caption={`Ratio ${data.artificial_ratio.toFixed(2)}`} explainer="Tags clustered with sparse, repetitive, newly-created accounts. A high ratio may indicate coordinated inauthentic behaviour." />
            <StatBlock label="Phases" value={Object.keys(phaseCounts).length.toString()} caption={Object.entries(phaseCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(' · ')} explainer="Birth · Growth · Peak · Contestation · Co-optation · Decay · Resurrection." />
          </StatGrid>
        </div>
      </Panel>

      {data.artificial_ratio > 0.4 && (
        <div className="border border-signal-neg bg-signal-neg-soft p-5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-signal-neg shrink-0 mt-0.5" />
          <p className="text-sm text-ink">
            <strong className="text-signal-neg">Significant artificial amplification</strong> —{' '}
            {(data.artificial_ratio * 100).toFixed(0)}% of scored hashtags fall in the artificial cluster.
            Cross-check the top artificial tags with their posting cadence in the Network page.
          </p>
        </div>
      )}

      <Panel eyebrow={<Eyebrow>Distribution</Eyebrow>} title="Authenticity & lifecycle">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-3">Authenticity</h4>
            <div className="flex h-8 w-full border border-rule">
              <div className="bg-signal-pos" style={{ width: `${(organic / Math.max(data.authenticity.length, 1)) * 100}%` }} />
              <div className="bg-signal-neg" style={{ width: `${(artificial / Math.max(data.authenticity.length, 1)) * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs mt-2">
              <span className="text-signal-pos">Organic {organic}</span>
              <span className="text-signal-neg">Artificial {artificial}</span>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-3">Lifecycle</h4>
            <div className="space-y-1.5">
              {Object.entries(phaseCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([phase, count]) => (
                  <div key={phase} className="flex items-center gap-2">
                    <span className="text-xs text-ink w-28">{phase}</span>
                    <div className="flex-1 h-2 bg-paper-2">
                      <div className="h-full bg-ember" style={{ width: `${(count / data.hashtag_count) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono text-ink-soft w-8 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel eyebrow={<Eyebrow>Detail</Eyebrow>} title="All scored hashtags">
        <DataTable
          rowKey={(h) => h.hashtag}
          dense
          onRowClick={() => navigate({ name: 'overview', datasetId })}
          columns={[
            { key: 'tag', header: 'Hashtag', render: (h) => <span className="font-mono text-ink">#{h.hashtag}</span>, sortValue: (h) => h.hashtag },
            { key: 'score', header: 'Score', align: 'right', render: (h) => <span className="font-mono text-ink-soft">{h.score.toFixed(4)}</span>, sortValue: (h) => h.score },
            { key: 'label', header: 'Label', align: 'center', render: (h) => <Chip tone={h.label === 'Organic' ? 'pos' : 'neg'}>{h.label}</Chip> },
            { key: 'phase', header: 'Lifecycle', render: (h) => <span className="text-ink-soft text-xs">{h.lifecycle_phase}</span> },
          ]}
          rows={[...data.authenticity].sort((a, b) => a.score - b.score)}
        />
      </Panel>
    </div>
  );
}
