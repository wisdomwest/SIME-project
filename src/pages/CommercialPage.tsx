import { useState } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { getCommercial } from '../services/pythonApi';
import { getConfig, saveConfig, LLMProvider } from '../services/llmService';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { Button } from '../components/primitives/Button';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { Loader2, Store, AlertTriangle, Key } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend
} from 'recharts';

export function CommercialPage() {
  return (
    <PythonOnlyWrap feature="commercial content analysis">
      <CommercialView />
    </PythonOnlyWrap>
  );
}

function CommercialView() {
  const { route } = useUrlState();
  const { pythonDatasetId, commercialData, setCommercialData } = useSocialData();
  const datasetId = pythonDatasetId ?? (('datasetId' in route ? (route as { datasetId: string }).datasetId : '') as string);
  const config = getConfig();
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<LLMProvider>('tokenrouter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseKeywords, setBaseKeywords] = useState('Furniture, Computers and their accessories, Shoes, Betting and gambling, Vehicles and their accessories, Clothing, Airtime');

  // We can run this even without an LLM key if we just want regex matches.
  // The backend supports empty key. But we'll encourage a key.
  const data = commercialData;

  async function run(withLLM: boolean) {
    let keyToUse = '';
    if (withLLM) {
      keyToUse = apiKey || config?.apiKey || '';
      if (!keyToUse) {
        setError('Add an API key to enable advanced co-optation analysis.');
        setShowKey(true);
        return;
      }
    }
    
    setLoading(true);
    setError(null);
    try {
      const r = await getCommercial(datasetId, keyToUse, baseKeywords, withLLM);
      setCommercialData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commercial analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  // Formatting data for charts
  const categoryData = data ? Object.entries(data.category_counts)
    .filter(([_, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count) : [];

  const pieData = data ? [
    { name: 'Commercial', value: data.commercial_tweets },
    { name: 'Organic / Other', value: Math.max(0, data.total_tweets - data.commercial_tweets) }
  ] : [];

  const COLORS = ['#ef4444', '#9ca3af']; // red for commercial, gray for organic

  return (
    <div className="px-8 py-10 max-w-[1280px] mx-auto space-y-10">
      <header className="space-y-3">
        <Eyebrow accent>Commercial · Sales & Spam Analysis</Eyebrow>
        <h1
          className="font-display text-4xl text-ink font-light tracking-[-0.02em] font-serif"
          style={{ fontFamily: "'Times New Roman', Times, serif" }}
        >
          Commercial Intent & Keyword Analysis
        </h1>
        <p className="text-base text-ink-soft max-w-2xl leading-relaxed font-serif" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
          Identifies product promotion, services, and sales pitches co-opting the campaign hashtag. Uses specific keyword matching and optionally leverages advanced semantic models to detect co-optation strategies and local slang tactics.
        </p>
      </header>

      {!loading && (
        <Panel>
          <div className="flex items-center gap-4">
            <Store size={28} className="text-ember shrink-0" />
            <div className="flex-1">
              <h3 className="font-display text-2xl text-ink font-light" style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 100" }}>
                {data ? 'Run Another Scan' : 'Scan for Commercial Content'}
              </h3>
              <p className="text-sm text-ink-soft mt-1 font-serif" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                Enter base keywords or phrases to look for. Our automated systems will dynamically expand these to catch local slang and related topics.
              </p>
              <input
                type="text"
                value={baseKeywords}
                onChange={(e) => setBaseKeywords(e.target.value)}
                placeholder="E.g. Shoes, Jackets, CBD Delivery..."
                className="w-full mt-3 bg-paper border border-rule px-3 py-2 text-sm font-sans focus:border-ink outline-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => run(false)} variant="secondary" size="lg">Run Exact Match</Button>
              <Button onClick={() => run(true)} size="lg">Run with Automated Expansion</Button>
            </div>
          </div>
        </Panel>
      )}

      {(showKey || (!config && !data)) && (
        <Panel eyebrow={<Eyebrow>API key</Eyebrow>} title="Advanced Provider Credentials">
          <p className="text-sm text-ink-soft mb-4">
            Your key is stored in <code className="font-mono text-ember">localStorage</code> only.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            {(['tokenrouter', 'nvidia-nim', 'deepseek'] as LLMProvider[]).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`px-3 py-2 text-sm font-medium border ${
                  provider === p ? 'border-ember text-ember bg-ember-soft' : 'border-rule text-ink-soft hover:border-ink'
                }`}
              >
                {p === 'tokenrouter' ? 'TokenRouter' : p === 'nvidia-nim' ? 'NVIDIA NIM' : 'DeepSeek'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key"
              className="flex-1 bg-paper border border-rule px-3 py-2 text-sm font-mono focus:border-ink outline-none"
            />
            <Button onClick={() => { saveConfig(provider, apiKey.trim()); setShowKey(false); setApiKey(''); }} disabled={!apiKey.trim()}>
              <Key size={12} /> Save
            </Button>
          </div>
        </Panel>
      )}

      {loading && (
        <div className="p-20 flex flex-col items-center gap-3">
          <Loader2 size={20} className="text-ember animate-spin" />
          <p className="text-sm text-ink-soft">Scanning for commercial keywords…</p>
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
                  label="Commercial Volume"
                  value={data.commercial_tweets.toLocaleString()}
                  caption={`Out of ${data.total_tweets.toLocaleString()} tweets`}
                  emphasis={data.percentage_commercial > 5 ? 'neg' : 'none'}
                />
                <StatBlock
                  label="Commercial %"
                  value={`${data.percentage_commercial.toFixed(2)}%`}
                  caption="Tweets containing sales keywords"
                  emphasis={data.percentage_commercial > 5 ? 'neg' : 'none'}
                />
                <StatBlock
                  label="Unique Categories"
                  value={categoryData.length.toString()}
                  caption="Product & service types detected"
                />
                {data.ai_analysis && (
                  <StatBlock
                    label="Advanced Co-optation Score"
                    value={data.ai_analysis.commercial_cooptation_level.toFixed(2)}
                    caption={data.ai_analysis.bot_vs_genuine.slice(0, 30) + '...'}
                    emphasis={data.ai_analysis.commercial_cooptation_level > 0.4 ? 'neg' : 'pos'}
                  />
                )}
              </StatGrid>
              {data.expanded_keywords && data.expanded_keywords.length > 0 && (
                <div className="mt-6 pt-6 border-t border-rule">
                  <h4 className="text-sm font-medium text-ink mb-2">Expanded Keywords Used</h4>
                  <div className="flex flex-wrap gap-2">
                    {data.expanded_keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-1 bg-paper border border-rule text-xs text-ink-soft rounded-full">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel eyebrow={<Eyebrow accent>Volume</Eyebrow>} title="Commercial vs Organic">
              <div className="h-64 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip cursor={{ fill: 'transparent' }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel eyebrow={<Eyebrow accent>Breakdown</Eyebrow>} title="Top Categories">
              <div className="h-64 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData} layout="vertical" margin={{ left: 40, right: 20 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} fontSize={12} />
                    <Tooltip cursor={{ fill: '#f3f4f6' }} />
                    <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel eyebrow={<Eyebrow accent>Timeline</Eyebrow>} title="Commercial Co-optation Trend">
             <div className="h-64 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="#ef4444" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="total" stroke="#9ca3af" dot={false} name="Total Tweets" />
                    <Line yAxisId="right" type="monotone" dataKey="commercial" stroke="#ef4444" dot={false} name="Commercial Tweets" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
          </Panel>

          {data.ai_analysis && (
            <Panel eyebrow={<Eyebrow>Expert Assessment</Eyebrow>} title="Automated Analyst Report">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-ink">Bot vs Genuine</h4>
                  <p className="text-sm text-ink-soft">{data.ai_analysis.bot_vs_genuine}</p>
                </div>
                <div>
                  <h4 className="font-medium text-ink">Main Selling Tactics</h4>
                  <ul className="list-disc list-inside text-sm text-ink-soft space-y-1">
                    {data.ai_analysis.main_tactics.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-ink">Analysis Brief</h4>
                  <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap font-body">
                    {data.ai_analysis.analysis_text}
                  </p>
                </div>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
