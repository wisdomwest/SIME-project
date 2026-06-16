import { useSocialData } from '../hooks/useSocialData';
import { useUrlState } from '../app/useUrlState';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { StatBlock } from '../components/primitives/StatBlock';
import { Chip } from '../components/primitives/Chip';
import { formatNumber, sentimentTone } from '../app/format';
import { Button } from '../components/primitives/Button';
import { Printer } from 'lucide-react';

export function ReportPage() {
  const { route } = useUrlState();
  const { graphData, computedMetrics, aiInsights, filteredData } = useSocialData();

  const datasetId = route.name !== 'landing' && route.name !== 'docs' ? route.datasetId : '';
  const displayV = filteredData?.vertices || graphData?.vertices || [];
  const m = computedMetrics;

  if (!m || !graphData) return null;

  const top10 = [...graphData.vertices].sort((a, b) => b.degree - a.degree).slice(0, 10);
  const top5B = [...graphData.vertices].sort((a, b) => b.betweenness - a.betweenness).slice(0, 5);
  const communities = new Map<number, number>();
  graphData.vertices.forEach((v) => communities.set(v.cluster, (communities.get(v.cluster) || 0) + 1));
  const communityList = [...communities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      {/* Screen-only toolbar */}
      <div className="no-print sticky top-0 z-10 bg-paper border-b border-rule px-8 py-3 flex items-center justify-between">
        <Eyebrow>Report view</Eyebrow>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer size={12} /> Print / save as PDF
          </Button>
        </div>
      </div>

      {/* Printable report */}
      <article className="max-w-[860px] mx-auto px-12 py-16 print:px-0 print:py-0 print:max-w-none space-y-12">
        {/* Masthead */}
        <header className="border-b-2 border-ink pb-6 space-y-4">
          <div className="flex items-center justify-between">
            <Eyebrow accent>SIMElab Africa · Network analysis report</Eyebrow>
            <span className="font-mono text-[10px] text-ink-mute">
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
          </div>
          <h1
            className="font-display text-5xl text-ink font-light leading-[1.05] tracking-[-0.025em]"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 100" }}
          >
            {datasetId} — Network analysis
          </h1>
          <p className="text-sm text-ink-soft max-w-2xl">
            {displayV.length.toLocaleString()} accounts · {m.totalEdges.toLocaleString()} connections ·{' '}
            {m.connectedComponents} {m.connectedComponents === 1 ? 'community' : 'communities'} · density {m.density.toFixed(4)} ·{' '}
            {(m.reciprocity * 100).toFixed(2)}% reciprocal
          </p>
        </header>

        {/* Network at a glance */}
        <section>
          <ReportSection title="Network at a glance" num="01" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 divide-x divide-rule [&>*:not(:first-child)]:pl-6 mt-6">
            <StatBlock label="Vertices" value={formatNumber(m.totalVertices)} />
            <StatBlock label="Edges" value={formatNumber(m.totalEdges)} />
            <StatBlock label="Density" value={m.density.toFixed(4)} />
            <StatBlock label="Avg degree" value={m.avgDegree.toFixed(1)} />
            <StatBlock label="Components" value={String(m.connectedComponents)} />
            <StatBlock label="Reciprocity" value={`${(m.reciprocity * 100).toFixed(2)}%`} />
          </div>
        </section>

        <div className="page-break" />

        {/* Top accounts */}
        <section>
          <ReportSection title="Top accounts by degree" num="02" />
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="border-b border-ink">
                <th className="text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">#</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">Account</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">Deg</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">PR</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">BC</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute py-2">Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((v, i) => (
                <tr key={v.id} className="border-b border-rule">
                  <td className="py-2 font-mono text-[10px] text-ink-mute w-8">{String(i + 1).padStart(2, '0')}</td>
                  <td className="py-2 text-ink">@{v.label}</td>
                  <td className="py-2 text-right font-mono text-ink">{v.degree}</td>
                  <td className="py-2 text-right font-mono text-ink-soft">{v.pagerank.toFixed(4)}</td>
                  <td className="py-2 text-right font-mono text-ink-soft">{v.betweenness.toFixed(4)}</td>
                  <td className="py-2 text-right">
                    <Chip tone={sentimentTone(v.sentiment)}>{v.sentiment}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="page-break" />

        {/* Communities */}
        <section>
          <ReportSection title="Communities" num="03" />
          <div className="mt-4 space-y-3">
            {communityList.map(([cid, size]) => {
              const top = [...graphData.vertices].filter((v) => v.cluster === cid).sort((a, b) => b.degree - a.degree)[0];
              const pct = (size / displayV.length) * 100;
              return (
                <div key={cid} className="flex items-center gap-4">
                  <span className="font-mono text-xs text-ink-mute w-12">C{cid + 1}</span>
                  <span className="flex-1 text-sm text-ink truncate">@{top?.label || '—'}</span>
                  <div className="w-32 h-1.5 bg-paper-2 border border-rule">
                    <div className="h-full bg-ember" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-mono text-xs text-ink-soft w-20 text-right">{size.toLocaleString()} · {pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="page-break" />

        {/* Bridge accounts */}
        <section>
          <ReportSection title="Bridge accounts (betweenness)" num="04" />
          <p className="text-sm text-ink-soft mt-4 leading-relaxed">
            These accounts connect otherwise distant parts of the network. Removing them would measurably
            increase the path length between communities — they are the structural backbone of the
            conversation.
          </p>
          <ol className="mt-4 space-y-2">
            {top5B.map((v, i) => (
              <li key={v.id} className="flex items-baseline gap-3 border-b border-rule pb-2">
                <span className="font-mono text-[10px] text-ink-mute w-6">0{i + 1}</span>
                <span className="font-display text-base text-ink" style={{ fontVariationSettings: "'opsz' 30, 'SOFT' 100" }}>
                  @{v.label}
                </span>
                <span className="font-mono text-xs text-ink-soft ml-auto">
                  betweenness {v.betweenness.toFixed(4)} · community C{v.cluster + 1}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* AI signals */}
        {aiInsights && (
          <section className="page-break">
            <ReportSection title="Automated signals" num="05" />
            <div className="mt-4 grid grid-cols-2 gap-6">
              <Signal label="Bot activity" value={`${Math.round(aiInsights.botActivityScore * 100)}%`} />
              <Signal label="Polarisation index" value={aiInsights.polarizationIndex.toFixed(2)} />
              <Signal label="Suspicious accounts flagged" value={String(aiInsights.suspiciousAccounts.length)} />
              <Signal label="Distinct narratives" value={String(aiInsights.keyNarratives.length)} />
            </div>
            {aiInsights.suspiciousAccounts.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-2">
                  Top suspicious accounts
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {aiInsights.suspiciousAccounts.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-signal-neg w-8">{Math.round(a.score * 100)}%</span>
                      <span className="text-ink">@{a.label}</span>
                      <span className="text-ink-soft text-xs">— {a.reasons[0]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Methodology */}
        <section className="page-break">
          <ReportSection title="Methodology" num="06" />
          <div className="mt-4 space-y-3 text-xs text-ink-soft leading-relaxed">
            <p>
              <strong className="text-ink">Network metrics.</strong> Computed in-browser with graphology:
              Brandes' algorithm for betweenness, power iteration for PageRank and eigenvector, and
              a manual BFS for closeness and clustering coefficient. Community detection uses the
              Louvain method (graphology-communities-louvain).
            </p>
            <p>
              <strong className="text-ink">Bot scoring.</strong> Composite of five structural signals:
              retweet-amplification ratio, posting-interval coefficient of variation, network-position
              anomaly, echo-chamber index (Louvain community overlap), and follower-sparse connectivity.
              No tweet text is read.
            </p>
            <p>
              <strong className="text-ink">Sentiment.</strong> k-means++ on the nine-dimensional feature
              vector with k=3. Clusters are re-labelled: high out-degree + low reciprocity → Negative;
              high reciprocity + high betweenness → Positive; remainder → Neutral.
            </p>
            <p>
              <strong className="text-ink">Censorship indicators.</strong> Fiedler value (λ₂ of graph
              Laplacian) for algebraic connectivity. CVI = max-betweenness ÷ λ₂ for vulnerability.
              A node whose removal increases the number of components by more than 10% is flagged
              as "fragmenting".
            </p>
          </div>
        </section>

        <footer className="border-t border-ink pt-4 text-[10px] uppercase tracking-[0.18em] text-ink-mute font-semibold flex justify-between">
          <span>SIMElab Africa · USIU-Africa</span>
          <span>simelab.africa</span>
        </footer>
      </article>
    </div>
  );
}

function ReportSection({ title, num }: { title: string; num: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-mono text-[10px] text-ink-mute">{num}</span>
        <Eyebrow accent>Section</Eyebrow>
      </div>
      <h2
        className="font-display text-3xl text-ink font-light tracking-[-0.02em] border-b border-ink pb-2"
        style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
      >
        {title}
      </h2>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-ember pl-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">{label}</div>
      <div className="font-display text-3xl text-ink font-light mt-1" style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}>{value}</div>
    </div>
  );
}
