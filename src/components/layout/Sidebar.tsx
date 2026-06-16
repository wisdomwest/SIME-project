import { useState, useRef, useMemo } from 'react';
import { useUrlState } from '../../app/useUrlState';
import { useSocialData } from '../../hooks/useSocialData';
import { FilterState } from '../../hooks/useSocialData';
import { Eyebrow } from '../primitives/Eyebrow';
import { Chip, ChipTone } from '../primitives/Chip';
import { Calendar, RotateCcw, Upload } from 'lucide-react';

const SENTIMENT_TONE: Record<'Pos' | 'Neu' | 'Neg', ChipTone> = {
  Pos: 'pos',
  Neu: 'neu',
  Neg: 'neg',
};

export function Sidebar({ hasData }: { hasData: boolean }) {
  const { route } = useUrlState();
  const { graphData, filters, updateFilters, resetFilters, processFile, isLoading } = useSocialData();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const datasetId = route.name !== 'landing' && route.name !== 'docs' ? route.datasetId : null;
  const isLanding = route.name === 'landing';

  const platformOptions = useMemo(() => {
    if (!graphData) return [];
    return [...new Set(graphData.vertices.map((v) => v.platform).filter(Boolean))];
  }, [graphData]);

  const topicOptions = useMemo(() => {
    if (!graphData) return [];
    return [...new Set(graphData.vertices.map((v) => v.topic).filter(Boolean))];
  }, [graphData]);

  const clusterOptions = useMemo(() => {
    if (!graphData) return [];
    const set = new Set<number>();
    graphData.vertices.forEach((v) => set.add(v.cluster));
    return [...set].sort((a, b) => a - b);
  }, [graphData]);

  function setFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    updateFilters({ [key]: value } as Partial<FilterState>);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx'))) {
      processFile(file);
    }
  }

  if (!hasData || isLanding || !graphData) {
    return (
      <aside className="w-[280px] shrink-0 border-r border-rule bg-paper flex flex-col h-full">
        <div className="p-5 space-y-6">
          <Eyebrow>Field guide</Eyebrow>
          <h2
            className="font-display text-xl font-light text-ink"
            style={{ fontVariationSettings: "'opsz' 72, 'SOFT' 100" }}
          >
            About this tool
          </h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            SIMElab Data Explorer parses NodeXL exports and surfaces the social network structure, account
            influence, sentiment clusters, and indicators of coordinated behaviour that researchers need
            to brief journalists, civil-society partners, and policy teams.
          </p>

          <div className="border-t border-rule pt-5 space-y-3">
            <Eyebrow>How to read this</Eyebrow>
            <ul className="text-sm text-ink-soft space-y-2 list-none">
              <li>
                <span className="text-ink font-medium">Network</span> — accounts as nodes, retweets/replies/mentions as edges.
              </li>
              <li>
                <span className="text-ink font-medium">Sentiment</span> — clustered from network behaviour, not text.
              </li>
              <li>
                <span className="text-ink font-medium">Suspicious</span> — five-signal composite score, no NLP required.
              </li>
            </ul>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[280px] shrink-0 border-r border-rule bg-paper flex flex-col h-full">
      <div
        className={`p-5 border-b border-rule transition-colors ${isDragging ? 'bg-ember-soft' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
        />
        <Eyebrow accent={isDragging}>Dataset</Eyebrow>
        <h2
          className="font-display text-lg text-ink font-light mt-1 truncate"
          style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 100" }}
          title={datasetId || ''}
        >
          {datasetId}
        </h2>
        <p className="font-mono text-[11px] text-ink-mute mt-1">
          {graphData.vertices.length.toLocaleString()} accounts · {graphData.edges.length.toLocaleString()} edges
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 text-xs font-medium text-ink border border-rule hover:border-ink hover:bg-paper-2 transition-colors py-1.5 disabled:opacity-40"
        >
          <Upload size={12} />
          {isLoading ? 'Loading…' : 'Replace dataset'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <Eyebrow>Search</Eyebrow>
          <input
            value={filters.keyword}
            onChange={(e) => setFilter('keyword', e.target.value)}
            placeholder="Handle, hashtag, or text"
            className="mt-2 w-full bg-transparent border-b border-rule focus:border-ember outline-none text-sm py-1.5 placeholder:text-ink-mute"
          />
        </div>

        <div>
          <Eyebrow>Sort by</Eyebrow>
          <select
            value={filters.sortBy}
            onChange={(e) => setFilter('sortBy', e.target.value)}
            className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none"
          >
            <option>Degree</option>
            <option>Betweenness</option>
            <option>PageRank</option>
            <option>Followers</option>
            <option>Clustering</option>
            <option>Date</option>
          </select>
        </div>

        <div>
          <Eyebrow>Sentiment</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['Pos', 'Neu', 'Neg'] as const).map((s) => {
              const on = filters.sentiment.includes(s);
              return (
                <button
                  key={s}
                  onClick={() =>
                    setFilter(
                      'sentiment',
                      on
                        ? filters.sentiment.filter((x) => x !== s)
                        : [...filters.sentiment, s],
                    )
                  }
                >
                  <Chip tone={on ? SENTIMENT_TONE[s] : 'ghost'}>{s}</Chip>
                </button>
              );
            })}
          </div>
        </div>

        {clusterOptions.length > 1 && (
          <div>
            <Eyebrow>Community</Eyebrow>
            <select
              value={filters.selectedCluster}
              onChange={(e) => setFilter('selectedCluster', parseInt(e.target.value))}
              className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none"
            >
              <option value={-1}>All communities</option>
              {clusterOptions.map((c) => (
                <option key={c} value={c}>Community {c + 1}</option>
              ))}
            </select>
          </div>
        )}

        {platformOptions.length > 1 && (
          <div>
            <Eyebrow>Platform</Eyebrow>
            <select
              value={filters.platform}
              onChange={(e) => setFilter('platform', e.target.value)}
              className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none"
            >
              <option>All Platforms</option>
              {platformOptions.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        {topicOptions.length > 1 && (
          <div>
            <Eyebrow>Topic</Eyebrow>
            <select
              value={filters.topic}
              onChange={(e) => setFilter('topic', e.target.value)}
              className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none"
            >
              <option>All Topics</option>
              {topicOptions.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Eyebrow>Min followers</Eyebrow>
            <input
              type="number"
              value={filters.minFollowers || ''}
              onChange={(e) => setFilter('minFollowers', parseInt(e.target.value) || 0)}
              className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none font-mono"
            />
          </div>
          <div>
            <Eyebrow>Min links</Eyebrow>
            <input
              type="number"
              value={filters.minDegree || ''}
              onChange={(e) => setFilter('minDegree', parseInt(e.target.value) || 0)}
              className="mt-2 w-full bg-transparent border-b border-rule text-sm py-1.5 outline-none font-mono"
            />
          </div>
        </div>

        <div>
          <Eyebrow className="flex items-center gap-1.5">
            <Calendar size={10} /> Date range
          </Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="date"
              value={filters.dateRange[0]}
              onChange={(e) => setFilter('dateRange', [e.target.value, filters.dateRange[1]])}
              className="bg-transparent border-b border-rule text-xs py-1 outline-none font-mono text-ink-soft"
            />
            <input
              type="date"
              value={filters.dateRange[1]}
              onChange={(e) => setFilter('dateRange', [filters.dateRange[0], e.target.value])}
              className="bg-transparent border-b border-rule text-xs py-1 outline-none font-mono text-ink-soft"
            />
          </div>
        </div>

        <button
          onClick={resetFilters}
          className="inline-flex items-center gap-1.5 text-xs text-ink-mute hover:text-ink transition-colors"
        >
          <RotateCcw size={11} /> Reset all filters
        </button>
      </div>
    </aside>
  );
}
