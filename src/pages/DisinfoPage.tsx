import { useEffect, useState, useCallback } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { DisinfoData, getDisinformation } from '../services/pythonApi';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { DataTable, Column } from '../components/primitives/DataTable';
import { Chip } from '../components/primitives/Chip';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { Loader2, AlertTriangle } from 'lucide-react';

export function DisinfoPage() {
  return (
    <PythonOnlyWrap feature="disinformation detection">
      <DisinfoView />
    </PythonOnlyWrap>
  );
}

function DisinfoView() {
  const { route, updateExtras } = useUrlState();
  const { pythonDatasetId } = useSocialData();
  const routeDataset = ('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string;
  const datasetId = pythonDatasetId ?? routeDataset;
  const [data, setData] = useState<DisinfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    getDisinformation(datasetId)
      .then(setData)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch disinformation analysis.');
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
        <p className="text-sm text-ink-soft">Scoring five signals per account…</p>
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

  const total = data.risk_distribution.clean + data.risk_distribution.suspicious + data.risk_distribution.likely_disinfo;
  const cleanPct = (data.risk_distribution.clean / Math.max(total, 1)) * 100;
  const suspPct = (data.risk_distribution.suspicious / Math.max(total, 1)) * 100;
  const disinfoPct = (data.risk_distribution.likely_disinfo / Math.max(total, 1)) * 100;

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Disinformation · 5-signal composite</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          Quantitative Assessment of Coordinated Behavior
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed">
          Each account receives a score in <code className="text-ember font-mono text-sm">[0, 1]</code> from a
          weighted sum of five structural signals. No text is read. Thresholds:{' '}
          <code className="font-mono text-sm">&lt;0.35</code> clean,{' '}
          <code className="font-mono text-sm">0.35–0.60</code> suspicious,{' '}
          <code className="font-mono text-sm">≥0.60</code> likely disinformation.
        </p>
      </header>

      <Panel padded={false}>
        <div className="p-6">
          <StatGrid>
            <StatBlock label="Mean score" value={data.score_stats.mean.toFixed(4)} explainer="Average composite score across all accounts in the dataset." />
            <StatBlock label="Std deviation" value={data.score_stats.std.toFixed(4)} explainer="Spread of the distribution. High std = clear separation between clean and suspicious accounts." />
            <StatBlock label="Max" value={data.score_stats.max.toFixed(4)} emphasis={data.score_stats.max > 0.6 ? 'neg' : 'ink'} explainer="Highest individual score in the dataset." />
            <StatBlock label="Likely disinfo" value={`${data.risk_distribution.likely_disinfo}`} emphasis="neg" caption={`${disinfoPct.toFixed(1)}% of accounts`} explainer="Accounts above the 0.60 threshold." />
            <StatBlock label="Suspicious" value={`${data.risk_distribution.suspicious}`} emphasis="warn" caption={`${suspPct.toFixed(1)}%`} explainer="Accounts in the 0.35–0.60 band." />
            <StatBlock label="Clean" value={`${data.risk_distribution.clean}`} emphasis="pos" caption={`${cleanPct.toFixed(1)}%`} explainer="Accounts below the 0.35 threshold." />
          </StatGrid>
        </div>
      </Panel>

      <Panel eyebrow={<Eyebrow>Risk distribution</Eyebrow>} title="By band">
        <div className="space-y-3">
          <RiskBar label="Likely disinfo" pct={disinfoPct} count={data.risk_distribution.likely_disinfo} tone="bg-signal-neg" />
          <RiskBar label="Suspicious" pct={suspPct} count={data.risk_distribution.suspicious} tone="bg-signal-warn" />
          <RiskBar label="Clean" pct={cleanPct} count={data.risk_distribution.clean} tone="bg-signal-pos" />
        </div>
      </Panel>

      <Panel
        eyebrow={<Eyebrow>Top 30</Eyebrow>}
        title="Highest composite scores"
        description="Click a row to open the account deep-dive drawer."
      >
        <DataTable
          rowKey={(r) => r.node}
          dense
          onRowClick={(r) => updateExtras({ selectedNode: r.node })}
          columns={disinfoColumns()}
          rows={data.scores.slice(0, 30)}
        />
      </Panel>

      {disinfoPct > 0.2 && (
        <div className="border border-signal-neg bg-signal-neg-soft p-5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-signal-neg shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-ink">
              <strong className="text-signal-neg">{disinfoPct.toFixed(1)}% of accounts</strong> score above the disinformation threshold.
            </p>
            <p className="text-xs text-ink-soft mt-1 leading-relaxed">
              This is high. Cross-check the top 10 against their posting cadence and whether their mentions
              cluster in time. Genuine communities sometimes trip these signals — the score is a starting
              point, not a verdict.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function RiskBar({ label, pct, count, tone }: { label: string; pct: number; count: number; tone: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-ink font-medium">{label}</span>
        <span className="font-mono text-ink-soft">{count.toLocaleString()} · {pct.toFixed(1)}%</span>
      </div>
      <div className="h-3 bg-paper-2 border border-rule">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function disinfoColumns(): Column<DisinfoData['scores'][number]>[] {
  return [
    { key: 'node', header: 'Account', render: (s) => <span className="text-ink">@{s.node}</span>, sortValue: (s) => s.disinfo_score },
    {
      key: 'score',
      header: 'Score',
      align: 'right',
      width: '88px',
      render: (s) => <span className="font-mono text-ink">{s.disinfo_score.toFixed(4)}</span>,
      sortValue: (s) => s.disinfo_score,
    },
    {
      key: 'risk',
      header: 'Risk',
      align: 'right',
      width: '110px',
      render: (s) => (
        <Chip tone={s.risk_level === 'clean' ? 'pos' : s.risk_level === 'suspicious' ? 'warn' : 'neg'}>
          {s.risk_level.replace('_', ' ')}
        </Chip>
      ),
    },
    {
      key: 'a1',
      header: 'Retweet amp',
      align: 'right',
      width: '90px',
      render: (s) => <span className="font-mono text-ink-mute text-xs">{(s.retweet_amplification ?? 0).toFixed(2)}</span>,
    },
    {
      key: 'a3',
      header: 'Net pos',
      align: 'right',
      width: '78px',
      render: (s) => <span className="font-mono text-ink-mute text-xs">{(s.network_position_anomaly ?? 0).toFixed(2)}</span>,
    },
    {
      key: 'a4',
      header: 'Echo',
      align: 'right',
      width: '72px',
      render: (s) => <span className="font-mono text-ink-mute text-xs">{(s.echo_chamber_index ?? 0).toFixed(2)}</span>,
    },
    {
      key: 'verified',
      header: 'Verified',
      align: 'right',
      width: '78px',
      render: (s) => (s.verified ? <Chip tone="pos">yes</Chip> : <span className="text-ink-mute text-xs">—</span>),
    },
  ];
}
