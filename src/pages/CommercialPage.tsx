import { useState } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { getCommercial } from '../services/pythonApi';
import { getConfig } from '../services/llmService';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { StatBlock, StatGrid } from '../components/primitives/StatBlock';
import { Button } from '../components/primitives/Button';
import { PythonOnlyWrap } from '../components/layout/BackendOffline';
import { Loader2, Store, AlertTriangle, Search, CheckCircle2, HelpCircle } from 'lucide-react';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseKeywords, setBaseKeywords] = useState('Furniture, Computers and their accessories, Shoes, Betting and gambling, Vehicles and their accessories, Clothing, Airtime');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  // Exact matching can run without a configured LLM provider.
  const data = commercialData;

  async function run(withLLM: boolean) {
    if (withLLM && !config) {
      setError('Server-side LLM is not configured. Add a provider key to the backend environment.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const r = await getCommercial(datasetId, baseKeywords, withLLM);
      setCommercialData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commercial analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  // Formatting data for charts
  const categoryData = data ? Object.entries(data.category_counts)
    .filter(([, count]) => count > 0)
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
              <Button onClick={() => run(false)} variant="ghost" size="lg">Run Exact Match</Button>
              <Button onClick={() => run(true)} size="lg">Run with Automated Expansion</Button>
            </div>
          </div>
        </Panel>
      )}

      {!config && !data && (
        <Panel eyebrow={<Eyebrow>LLM configuration</Eyebrow>} title="Optional server provider">
          <p className="text-sm text-ink-soft">
            Exact matching works without an LLM. Configure a provider key in the backend environment to enable automated expansion; credentials never enter the browser.
          </p>
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
          {data.debug_info && (
            <div className="bg-paper-2 border border-rule px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-soft">
              <span className="font-semibold text-ink-mute uppercase tracking-wider text-[10px] self-center">Diagnostics</span>
              <span>Loaded: <strong className="text-ink">{data.debug_info.total_rows_loaded.toLocaleString()}</strong> rows</span>
              <span>Text Column: <code className="text-ember font-mono">{data.debug_info.text_column || 'none'}</code></span>
              <span>Source Handle Column: <code className="text-ember font-mono">{data.debug_info.source_column || 'none'}</code></span>
              <span>Target Handle Column: <code className="text-ember font-mono">{data.debug_info.target_column || 'none'}</code></span>
              <span>Active Entities: <strong className="text-ink">{data.debug_info.active_usernames_count}</strong></span>
            </div>
          )}

          <Panel padded={false}>
            <div className="p-6">
              <StatGrid>
                <StatBlock
                  label="Commercial Volume"
                  value={data.commercial_tweets.toLocaleString()}
                  caption={`Out of ${data.total_tweets.toLocaleString()} tweets`}
                  emphasis={data.percentage_commercial > 5 ? 'neg' : undefined}
                />
                <StatBlock
                  label="Commercial %"
                  value={`${data.percentage_commercial.toFixed(2)}%`}
                  caption="Tweets containing sales keywords"
                  emphasis={data.percentage_commercial > 5 ? 'neg' : undefined}
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
              {!!data.keyword_mappings && Object.keys(data.keyword_mappings).length > 0 ? (
                <div className="mt-6 pt-6 border-t border-rule">
                  <h4 className="text-sm font-medium text-ink mb-3 font-serif" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                    Intelligent Search Resolution
                  </h4>
                  <div className="space-y-4">
                    {Object.entries(data.keyword_mappings).map(([category, mapping]) => {
                      const terms = mapping.terms || [];
                      const totalHits = mapping.total_hits ?? terms.reduce((s, t) => s + t.hits, 0);
                      const hasResolution = !!mapping.resolved_entity && totalHits > 0;
                      const resolvedName = mapping.resolved_entity ?? '';
                      return (
                        <div key={category} className="border border-rule p-4 bg-paper-2/40 space-y-3">

                          {/* ── Header: original query + hit count ── */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Search size={13} className="text-ink-mute shrink-0" />
                              <span className="font-medium text-sm text-ink font-serif" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
                                &ldquo;{category}&rdquo;
                              </span>
                            </div>
                            <span className={`text-xs px-2 py-0.5 font-mono border ${
                              totalHits > 0 ? 'bg-ember-soft border-ember text-ember' : 'bg-paper border-rule text-ink-mute'
                            }`}>
                              {totalHits.toLocaleString()} hits
                            </span>
                          </div>

                          {/* ── Resolution banner ── */}
                          {hasResolution ? (
                            <div className="pl-3 border-l-2 border-ember space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <CheckCircle2 size={13} className="text-ember shrink-0" />
                                <span className="text-xs text-ink-soft">Resolved to:</span>
                                <span className="font-mono text-xs font-bold text-white bg-ember border border-ember px-2 py-0.5">
                                  {resolvedName}
                                </span>
                                {mapping.resolved_entity_type && (
                                  <span className="text-xs border border-rule px-2 py-0.5 text-ink-mute">
                                    {mapping.resolved_entity_type}
                                  </span>
                                )}
                                {mapping.confidence != null && (
                                  <span className={`text-xs px-2 py-0.5 border ${
                                    mapping.confidence >= 0.7
                                      ? 'border-pos text-pos bg-pos-soft'
                                      : 'border-warn text-warn bg-warn-soft'
                                  }`}>
                                    {Math.round(mapping.confidence * 100)}% confident
                                  </span>
                                )}
                              </div>
                              {!!mapping.intent_summary && (
                                <p className="text-xs text-ink-soft italic leading-relaxed">
                                  {mapping.intent_summary}
                                </p>
                              )}
                              {!!mapping.reasoning && (
                                <p className="text-xs text-ink-mute leading-relaxed">
                                  {mapping.reasoning}
                                </p>
                              )}
                            </div>
                          ) : totalHits === 0 ? (
                            <div className="pl-3 border-l-2 border-rule flex items-center gap-2">
                              <HelpCircle size={12} className="text-ink-mute shrink-0" />
                              <p className="text-xs text-ink-mute italic">No matches found in the dataset for this query.</p>
                            </div>
                          ) : null}

                          {/* ── Individual term chips ── */}
                          <div className="flex flex-wrap gap-2">
                            {terms.map((item, idx) => (
                              <span
                                key={idx}
                                className={`px-2 py-1 text-xs border transition-all ${
                                  item.term === resolvedName
                                    ? 'bg-ember text-white border-ember font-bold'
                                    : item.hits > 0
                                      ? 'bg-ember-soft border-ember text-ember font-medium'
                                      : 'bg-paper/40 border-rule text-ink-mute'
                                }`}
                              >
                                {item.term}
                                <span className="ml-1 opacity-80 font-mono">({item.hits})</span>
                              </span>
                            ))}
                          </div>

                          {/* ── Expandable Matched Tweets List ── */}
                          {mapping.sample_hits && mapping.sample_hits.length > 0 && (
                            <div className="pt-2 border-t border-rule/30">
                              <button
                                onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}
                                className="text-xs font-semibold text-ember hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                {expandedCategories[category] ? 'Hide' : 'Show'} Matched Tweets ({mapping.sample_hits.length})
                              </button>
                              
                              {expandedCategories[category] && (
                                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-2 border-l border-rule pl-3">
                                  {mapping.sample_hits.map((hit, i: number) => (
                                    <div key={i} className="text-xs bg-paper/30 p-2 border border-rule/30 rounded">
                                      <div className="flex justify-between items-center text-ink-mute mb-1 font-mono text-[10px]">
                                        <span>From: {hit.source || 'unknown'} {hit.target ? `→ To: ${hit.target}` : ''}</span>
                                        <span>{hit.date}</span>
                                      </div>
                                      <p className="text-ink leading-relaxed font-body">{hit.text}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                !!data.expanded_keywords && data.expanded_keywords.length > 0 ? (
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
                ) : null
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
