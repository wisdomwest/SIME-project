import { useState, useRef, useEffect } from 'react';
import { useUrlState } from '../app/useUrlState';
import { useSocialData } from '../hooks/useSocialData';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Button } from '../components/primitives/Button';
import { Upload, ArrowRight, Sparkles, Network, AlertTriangle, Hash, Shield } from 'lucide-react';

export function LandingPage() {
  const { navigate } = useUrlState();
  const { processFile, isLoading, error } = useSocialData();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) setFile(null);
  }, [error]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  async function start() {
    if (!file) return;
    const datasetId = file.name.replace(/\.(xlsx|csv)$/i, '');
    await processFile(file);
    navigate({ name: 'overview', datasetId });
  }

  return (
    <div className="min-h-full bg-paper overflow-y-auto">
      {/* HERO ─────────────────────────────────────────────────────── */}
      <section className="border-b border-rule">
        <div className="max-w-[1280px] mx-auto px-8 py-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-7 space-y-8">
            <Eyebrow accent>Vol. 5 · Issue 01 · Social Intelligence</Eyebrow>
            <h1
              className="font-display text-ink font-light text-[64px] leading-[0.95] tracking-[-0.025em]"
              style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 100" }}
            >
              Perform Structural<br />
              <em className="text-ember not-italic">Network Analysis.</em>
            </h1>
            <p className="text-lg text-ink-soft leading-relaxed max-w-xl">
              SIMElab Data Explorer processes NodeXL exports to deliver structured network assessments, characterizing key influencers, community bridges, coordinated campaign behaviors, and narrative sentiment profiles. Purpose-built for researchers, journalists, and policy analysts at USIU-Africa.
            </p>
            <div className="flex items-center gap-3">
              <Button onClick={() => inputRef.current?.click()} size="lg">
                <Upload size={14} /> Upload a NodeXL export
              </Button>
              <Button variant="ghost" size="lg" onClick={() => navigate({ name: 'docs' })}>
                Maths reference <ArrowRight size={14} />
              </Button>
            </div>
            <p className="text-xs text-ink-mute font-mono">
              Accepts .xlsx (NodeXL Pro multi-sheet) and .csv (edge list) · up to 200&nbsp;MB
            </p>
          </div>

          <aside className="lg:col-span-5">
            <div
              className={`border ${isDragging ? 'border-ember bg-ember-soft' : 'border-rule bg-paper-2'} p-8 transition-colors`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
              />
              <Eyebrow>Drop a file</Eyebrow>
              <p className="mt-2 text-sm text-ink-soft">
                Drop your NodeXL <span className="font-mono text-ink">.xlsx</span> or a CSV edge list anywhere in this panel,
                or click to browse.
              </p>
              {file ? (
                <div className="mt-5 border-t border-rule pt-5">
                  <Eyebrow accent>Selected</Eyebrow>
                  <p className="mt-2 font-display text-lg text-ink truncate" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-ink-mute font-mono">
                    {(file.size / 1024).toFixed(1)} KB · ready to analyse
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={start} disabled={isLoading}>
                      {isLoading ? 'Analysing…' : 'Begin analysis'} <ArrowRight size={14} />
                    </Button>
                    <Button variant="ghost" onClick={() => setFile(null)} disabled={isLoading}>
                      Clear
                    </Button>
                  </div>
                  {error && (
                    <p className="mt-3 text-xs text-signal-neg font-mono break-words">
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-5 border-t border-rule pt-5">
                  <p className="text-xs text-ink-mute leading-relaxed">
                    We'll auto-detect all 60+ NodeXL columns — Vertex 1/2, Betweenness Centrality, PageRank,
                    Followers, Tweet text, Hashtags, Sentiment, Dates. No template required.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      {/* WHAT YOU GET ─────────────────────────────────────────────── */}
      <section className="border-b border-rule">
        <div className="max-w-[1280px] mx-auto px-8 py-16">
          <header className="mb-10 max-w-2xl">
            <Eyebrow>Field guide</Eyebrow>
            <h2
              className="mt-3 font-display text-ink font-light text-4xl tracking-[-0.02em]"
              style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
            >
              Core Analytical Capabilities
            </h2>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-rule">
            {FEATURES.map((f) => (
              <article key={f.title} className="bg-paper p-7 space-y-3">
                <f.icon size={18} className="text-ember" />
                <h3 className="font-display text-xl font-light text-ink" style={{ fontVariationSettings: "'opsz' 48, 'SOFT' 100" }}>
                  {f.title}
                </h3>
                <p className="text-sm text-ink-soft leading-relaxed">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* METHODOLOGY ──────────────────────────────────────────────── */}
      <section className="bg-paper-2 border-b border-rule">
        <div className="max-w-[1280px] mx-auto px-8 py-16 grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-4">
            <Eyebrow>Methodology</Eyebrow>
            <h2
              className="mt-3 font-display text-3xl text-ink font-light tracking-[-0.02em]"
              style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
            >
              Rigorous Structural Computation
            </h2>
          </div>
          <div className="md:col-span-8 space-y-4 text-sm text-ink-soft leading-relaxed">
            <p>
              Sentiment, influence, and suspicion scores are computed from the <em>structure</em> of the
              network, not from reading the tweets. The browser pipeline uses graphology for centrality
              metrics and Louvain for community detection. The optional Python engine adds k-means
              clustering on nine network dimensions, a five-signal disinformation composite, and a
              Gaussian-mixture authenticity score for hashtags.
            </p>
            <p>
              Every metric in the UI is paired with a methodology tooltip. Hover the
              <span className="mx-1 align-middle inline-flex w-3.5 h-3.5 border border-rule rounded-full items-center justify-center text-[9px] text-ink-mute">i</span>
              next to any number to read the formula.
            </p>
          </div>
        </div>
      </section>

      <footer className="px-8 py-6 text-[10px] uppercase tracking-[0.18em] text-ink-mute font-semibold flex items-center justify-between">
        <span>SIMElab Africa · Freida Brown Innovation Center · USIU-Africa, Nairobi</span>
        <button onClick={() => navigate({ name: 'docs' })} className="hover:text-ink transition-colors">
          Maths reference
        </button>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    title: 'Network at a glance',
    body: 'Density, reciprocity, components, average clustering — surfaced on the overview and contextualised with an editorial interpretation, not just numbers.',
    icon: Network,
  },
  {
    title: 'Influencer mapping',
    body: 'Top accounts by degree, PageRank, betweenness, and a composite influence score. Click any handle to open the deep-dive drawer.',
    icon: Sparkles,
  },
  {
    title: 'Sentiment from structure',
    body: 'k-means on nine network dimensions labels each account Positive, Neutral, or Negative — without reading a single tweet.',
    icon: Hash,
  },
  {
    title: 'Disinformation signals',
    body: 'Five composite signals: retweet amplification, temporal regularity, network position, echo-chamber index, sparse follower connectivity.',
    icon: AlertTriangle,
  },
  {
    title: 'Censorship indicators',
    body: 'Algebraic connectivity (Fiedler value), structural-impact scores, and a snapshot diffing tool that finds disappeared bridge accounts.',
    icon: Shield,
  },
  {
    title: 'Narrative drift',
    body: 'A semantic pass that samples tweets from the early and late halves of the campaign and reports whether the conversation was co-opted.',
    icon: Network,
  },
];
