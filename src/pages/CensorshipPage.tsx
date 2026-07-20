import { useEffect, useState, useCallback } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { CensorshipData, ComparisonData, compareDatasets, getCensorship } from '../services/pythonApi';
import { usePythonBackend } from '../hooks/usePythonBackend';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { DataTable } from '../components/primitives/DataTable';
import { Chip } from '../components/primitives/Chip';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';

export function CensorshipPage() {
  return (
    <PythonOnlyWrap feature="censorship analysis">
      <CensorshipView />
    </PythonOnlyWrap>
  );
}

function CensorshipView() {
  const { route, updateExtras } = useUrlState();
  const { pythonDatasetId } = useSocialData();
  const routeDataset = ('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string;
  const datasetId = pythonDatasetId ?? routeDataset;
  const backend = usePythonBackend();
  const [data, setData] = useState<CensorshipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [t1, setT1] = useState(datasetId);
  const [t2, setT2] = useState('');
  const [comp, setComp] = useState<ComparisonData | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    getCensorship(datasetId)
      .then((res) => {
        setData(res);
        if (res?.dataset_id) {
          setT1(res.dataset_id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch censorship analysis.');
      })
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (backend.loadedDatasets.length > 0 && !t2) {
      const other = backend.loadedDatasets.find((d) => d !== t1);
      if (other) setT2(other);
    }
  }, [backend.loadedDatasets, t1, t2]);

  async function runCompare() {
    if (!t1 || !t2 || t1 === t2) {
      setCompError('Pick two different snapshots to compare.');
      return;
    }
    setCompLoading(true);
    setCompError(null);
    try {
      const r = await compareDatasets(t1, t2);
      setComp(r);
    } catch (e) {
      setCompError(e instanceof Error ? e.message : 'Comparison failed.');
    } finally {
      setCompLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-20 flex flex-col items-center gap-3">
        <Loader2 size={20} className="text-ember animate-spin" />
        <p className="text-sm text-ink-soft">Computing algebraic connectivity and structural impact…</p>
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

  const fragmenting = data.structural_holes.filter((h) => h.is_fragmenting).length;
  const disconnected = data.component_count > 1;
  const displayedFiedler = disconnected
    ? data.largest_component_fiedler
    : data.fiedler_value;
  const displayedCvi = disconnected ? data.component_cvi : data.cvi;
  const connectivityCaption = displayedFiedler == null
    ? 'Unavailable'
    : displayedFiedler < 0.01
      ? 'Very fragile'
      : displayedFiedler < 0.1
        ? 'Loosely connected'
        : 'Robust';

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Censorship · Structural hole analysis</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          Network Connectivity and Structural Bridges
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed">
          The Fiedler value (λ₂ of the graph Laplacian) measures algebraic connectivity. A disconnected
          whole network has λ₂ = 0, so this page also reports λ₂ for the largest connected component. The{' '}
          <strong className="text-ink">Censorship Vulnerability Index</strong> divides the highest
          betweenness by the matching λ₂; CVI is unavailable for a disconnected whole network.
        </p>
      </header>

      <Panel padded={false}>
        <div className="p-6">
          <StatGrid>
            <StatBlock
              label={disconnected ? 'Giant-component λ₂' : 'Fiedler λ₂'}
              value={displayedFiedler?.toFixed(4) ?? '—'}
              caption={disconnected ? `${data.component_count} total components · ${connectivityCaption}` : connectivityCaption}
              emphasis={displayedFiedler != null && displayedFiedler < 0.01 ? 'neg' : displayedFiedler != null && displayedFiedler < 0.1 ? 'warn' : 'pos'}
              explainer={disconnected
                ? `The whole graph has ${data.component_count} components and λ₂ = 0. This is the documented unnormalized Fiedler value of the largest component, covering ${(data.largest_component_share * 100).toFixed(1)}% of accounts.`
                : 'Second-smallest eigenvalue of the unnormalized graph Laplacian. Smaller values mean fewer redundant paths.'}
            />
            <StatBlock
              label={disconnected ? 'Giant-component CVI' : 'CVI'}
              value={displayedCvi?.toFixed(6) ?? 'N/A'}
              caption={disconnected ? `${(data.largest_component_share * 100).toFixed(1)}% node coverage` : 'Whole-network value'}
              emphasis={displayedFiedler != null && displayedFiedler < 0.1 ? 'warn' : 'ink'}
              explainer="SIMElab custom index = maximum directed betweenness ÷ the matching unnormalized Fiedler value. It is undefined when λ₂ = 0, so disconnected networks use internally consistent giant-component values."
            />
            <StatBlock
              label="Fragmenting"
              value={`${fragmenting} / ${data.structural_holes.length}`}
              caption="of top 20 would fragment"
              explainer="Top-20 structural holes whose removal would measurably increase the number of connected components."
            />
            <StatBlock
              label="Loaded datasets"
              value={backend.loadedDatasets.length.toString()}
              caption={backend.loadedDatasets.length > 1 ? 'ready for snapshot diffing' : 'load a second to diff'}
              explainer="Datasets the Python backend has analysed. Load a second one (e.g. a later snapshot) to enable the disappeared-account finder below."
            />
          </StatGrid>
        </div>
      </Panel>

      {disconnected ? (
        <div className="border border-signal-neg bg-signal-neg-soft p-5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-signal-neg shrink-0 mt-0.5" />
          <p className="text-sm text-ink">
            <strong className="text-signal-neg">Network is already fragmented into {data.component_count} components.</strong>{' '}
            The giant component contains {data.largest_component_nodes.toLocaleString()} accounts
            ({(data.largest_component_share * 100).toFixed(1)}%) and has λ₂ = {data.largest_component_fiedler?.toFixed(4) ?? 'N/A'}.
          </p>
        </div>
      ) : data.fiedler_value < 0.01 && (
        <div className="border border-signal-neg bg-signal-neg-soft p-5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-signal-neg shrink-0 mt-0.5" />
          <p className="text-sm text-ink">
            <strong className="text-signal-neg">Network is one edge from fragmentation.</strong> The
            Fiedler value is near zero — removing one of the top bridge accounts below would shatter the
            network into isolated components.
          </p>
        </div>
      )}

      <Panel
        eyebrow={<Eyebrow>Top 20</Eyebrow>}
        title="Structural holes"
        description="Ranked by structural impact: SI(v) = betweenness × log(degree + 1). A higher SI means the account plays a larger role in connecting otherwise distant parts of the network."
      >
        <DataTable
          rowKey={(h) => h.node}
          dense
          onRowClick={(h) => updateExtras({ selectedNode: h.node })}
          columns={[
            { key: 'node', header: 'Account', render: (h) => <span className="text-ink">@{h.node}</span>, sortValue: (h) => h.si_score },
            {
              key: 'si',
              header: 'SI',
              align: 'right',
              render: (h) => (
                <div className="flex items-center justify-end gap-2">
                  <span className="font-mono text-ink">{h.si_score.toFixed(5)}</span>
                  <span className="w-12 h-1 bg-paper-2 inline-block">
                    <span className="block h-full bg-ember" style={{ width: `${(h.si_score / Math.max(data.structural_holes[0]?.si_score || 1, 0.000001)) * 100}%` }} />
                  </span>
                </div>
              ),
              sortValue: (h) => h.si_score,
            },
            { key: 'bc', header: 'Betweenness', align: 'right', render: (h) => <span className="font-mono text-ink-soft">{h.betweenness.toFixed(5)}</span>, sortValue: (h) => h.betweenness },
            { key: 'deg', header: 'Degree', align: 'right', render: (h) => <span className="font-mono text-ink-soft">{h.degree}</span>, sortValue: (h) => h.degree },
            { key: 'frag', header: 'Fragments?', align: 'center', render: (h) => h.is_fragmenting ? <Chip tone="neg">yes</Chip> : <span className="text-ink-mute">—</span> },
          ]}
          rows={data.structural_holes}
        />
      </Panel>

      <Panel
        eyebrow={<Eyebrow>Snapshot diffing</Eyebrow>}
        title="Find disappeared bridge accounts"
        description="Compare two snapshots (e.g. Day 4 vs Day 5) to auto-detect critical bridge accounts that were active in T1 but vanished in T2. High SI disappeared = potential censorship target."
      >
        {backend.loadedDatasets.length < 2 ? (
          <p className="text-sm text-ink-soft">
            Load a second dataset on the Python backend (e.g. another day's export) to enable diffing.
            {backend.loadedDatasets.length > 0 && (
              <> Currently loaded: {backend.loadedDatasets.map((d) => <span key={d} className="font-mono mx-1 text-ink">{d}</span>)}.</>
            )}
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SnapshotSelect label="Base snapshot (T1)" value={t1} onChange={setT1} datasets={backend.loadedDatasets} />
              <SnapshotSelect label="Comparison snapshot (T2)" value={t2} onChange={setT2} datasets={backend.loadedDatasets} />
            </div>
            <button
              onClick={runCompare}
              disabled={compLoading}
              className="bg-ink text-paper px-5 py-2.5 text-sm font-medium hover:bg-ink-soft transition-colors disabled:opacity-40"
            >
              {compLoading ? 'Comparing…' : 'Compare snapshots'}
            </button>
            {compError && <p className="text-sm text-signal-neg">{compError}</p>}
            {comp && (
              <div className="border-t border-rule pt-5 space-y-3">
                <h4 className="text-sm font-medium text-ink">
                  {comp.disappeared_count} accounts disappeared
                </h4>
                {comp.disappeared_critical_nodes.length === 0 ? (
                  <p className="text-sm text-ink-soft italic">No critical disappeared accounts.</p>
                ) : (
                  <DataTable
                    rowKey={(n) => n.node}
                    dense
                    onRowClick={(n) => updateExtras({ selectedNode: n.node })}
                    columns={[
                      { key: 'node', header: 'Account', render: (n) => <span className="text-signal-neg">@{n.node}</span>, sortValue: (n) => n.si_score },
                      { key: 'si', header: 'SI', align: 'right', render: (n) => <span className="font-mono text-ink">{n.si_score.toFixed(5)}</span>, sortValue: (n) => n.si_score },
                      { key: 'bc', header: 'BC', align: 'right', render: (n) => <span className="font-mono text-ink-soft">{n.betweenness.toFixed(5)}</span>, sortValue: (n) => n.betweenness },
                      { key: 'deg', header: 'Deg', align: 'right', render: (n) => <span className="font-mono text-ink-soft">{n.degree}</span>, sortValue: (n) => n.degree },
                    ]}
                    rows={comp.disappeared_critical_nodes.slice(0, 20)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SnapshotSelect({ label, value, onChange, datasets }: { label: string; value: string; onChange: (v: string) => void; datasets: string[] }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute block mb-2">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-paper border border-rule px-3 py-2 text-sm text-ink pr-8 focus:border-ink outline-none"
        >
          <option value="">Select…</option>
          {datasets.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none" />
      </div>
    </div>
  );
}
