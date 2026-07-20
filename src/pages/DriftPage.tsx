import { useState } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { getSemanticDrift, DriftData } from '../services/pythonApi';
import { getConfig } from '../services/llmService';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { Button } from '../components/primitives/Button';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { Loader2, Brain, AlertTriangle } from 'lucide-react';

export function DriftPage() {
  return (
    <PythonOnlyWrap feature="narrative drift analysis">
      <DriftView />
    </PythonOnlyWrap>
  );
}

function DriftView() {
  const { route } = useUrlState();
  const { pythonDatasetId, driftData, setDriftData } = useSocialData();
  const routeDataset = ('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string;
  const datasetId = pythonDatasetId ?? routeDataset;
  const config = getConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriftData | null>(driftData ?? null);

  async function run() {
    if (!config) {
      setError('Server-side LLM is not configured. Add a provider key to the backend environment.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await getSemanticDrift(datasetId);
      setData(r);
      setDriftData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drift analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Drift · Semantic analysis</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
        >
          Semantic Drift & Narrative Evolution Analysis
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed">
          Analyzes the chronological subsets of the campaign using advanced semantic models to identify narrative shifts, evaluate structural Swahili / Sheng slang integration, and detect narrative co-optation by external actors.
        </p>
      </header>

      {!data && !loading && (
        <Panel>
          <div className="flex items-center gap-4">
            <Brain size={28} className="text-ember shrink-0" />
            <div className="flex-1">
              <h3 className="font-display text-2xl text-ink font-light" style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 100" }}>
                Narrative Analysis Ready
              </h3>
              <p className="text-sm text-ink-soft mt-1">
                The backend processes the unique tweets in the campaign (divided chronologically into early and late subsets) to analyze shifts in topics, sentiment, and structural code-switching. Expect a 30–90 second response.
              </p>
            </div>
            <Button onClick={run} size="lg">Execute Semantic Drift Analysis</Button>
          </div>
        </Panel>
      )}

      {!config && !data && (
        <Panel eyebrow={<Eyebrow>LLM configuration</Eyebrow>} title="Server provider required">
          <p className="text-sm text-ink-soft">
            Configure TOKENROUTER_API_KEY, NVIDIA_API_KEY, or DEEPSEEK_API_KEY in the backend environment. Credentials are never sent to the browser.
          </p>
        </Panel>
      )}

      {loading && (
        <div className="p-20 flex flex-col items-center gap-3">
          <Loader2 size={20} className="text-ember animate-spin" />
          <p className="text-sm text-ink-soft">Sampling tweets and querying semantic models…</p>
          <p className="text-[10px] text-ink-mute font-mono">Early / late split · Sheng/Swahili scan · JSON contract</p>
        </div>
      )}

      {error && (
        <div className="border border-signal-neg bg-signal-neg-soft p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-signal-neg shrink-0 mt-0.5" />
          <p className="text-sm text-ink">{error}</p>
        </div>
      )}

      {data && (
        <>
          <Panel padded={false}>
            <div className="p-6">
              <StatGrid>
                <StatBlock
                  label="Drift score"
                  value={data.drift_score.toFixed(2)}
                  caption={data.drift_score > 0.4 ? 'High narrative shift' : 'Low — stable topic'}
                  emphasis={data.drift_score > 0.4 ? 'neg' : 'pos'}
                />
                <StatBlock
                  label="Co-opted"
                  value={data.is_coopted ? 'YES' : 'NO'}
                  caption={data.is_coopted ? 'Narrative captured' : 'Organic topic'}
                  emphasis={data.is_coopted ? 'neg' : 'pos'}
                />
                <StatBlock
                  label="Swahili/Sheng"
                  value={`${data.swahili_sheng_count} / ${data.sample_size}`}
                  caption={`${Math.round((data.swahili_sheng_count / data.sample_size) * 100)}% of sample`}
                />
                <StatBlock
                  label="Tweets analysed"
                  value={data.total_tweets.toLocaleString()}
                  caption={`sample ${data.sample_size}`}
                />
              </StatGrid>
            </div>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel eyebrow={<Eyebrow accent>Origin</Eyebrow>} title="Early topics">
              <ul className="space-y-2">
                {data.early_topics.map((t: string, i: number) => (
                  <li key={i} className="font-display text-base text-ink leading-snug" style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 100" }}>
                    <span className="font-mono text-[10px] text-ink-mute mr-2">0{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel
              eyebrow={<Eyebrow accent>Evolution</Eyebrow>}
              title={data.is_coopted ? 'Co-opted narrative' : 'Campaign peak'}
            >
              <ul className="space-y-2">
                {data.late_topics.map((t: string, i: number) => (
                  <li key={i} className={`font-display text-base leading-snug ${data.is_coopted ? 'text-signal-neg' : 'text-ink'}`} style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 100" }}>
                    <span className="font-mono text-[10px] text-ink-mute mr-2">0{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel eyebrow={<Eyebrow>Analyst assessment</Eyebrow>} title="Expert Analysis">
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap font-body">
              {data.analysis_text}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
