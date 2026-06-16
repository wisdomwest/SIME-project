import { useSocialData } from '../../hooks/useSocialData';
import { Eyebrow } from '../primitives/Eyebrow';
import { Button } from '../primitives/Button';
import { Loader2, Activity, Network, Brain, GitBranch, BarChart3, CheckCircle2 } from 'lucide-react';

const STAGES = [
  { id: 'parsing', label: 'Parsing file', body: 'Reading columns, mapping NodeXL fields, building the graph.', icon: Activity },
  { id: 'metrics', label: 'Computing SNA metrics', body: 'Degree, betweenness, closeness, PageRank, eigenvector, clustering.', icon: BarChart3 },
  { id: 'communities', label: 'Detecting communities', body: 'Louvain modularity on the undirected projection.', icon: GitBranch },
  { id: 'graph', label: 'Building network layout', body: 'Force-directed positioning for visual exploration.', icon: Network },
  { id: 'ai', label: 'Running AI analysis', body: 'Bot scoring, narrative detection, polarization, time spikes.', icon: Brain },
];

export function LoadingOverlay() {
  const { isLoading, processingStage, dismissLoading } = useSocialData();
  const idx = STAGES.findIndex((s) => s.id === processingStage.stage);
  const pct = Math.round(processingStage.progress);
  const activeIdx = idx === -1 ? (processingStage.stage === 'done' ? STAGES.length : 0) : idx;

  if (!isLoading && processingStage.stage !== 'done') return null;

  return (
    <div className="fixed inset-0 z-50 bg-paper/95 backdrop-blur-[2px] flex items-center justify-center">
      <div className="w-full max-w-lg px-8 space-y-8">
        <header className="space-y-2">
          <Eyebrow accent>Working</Eyebrow>
          <h2
            className="font-display text-3xl font-light text-ink tracking-[-0.02em]"
            style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
          >
            {processingStage.stage === 'done' ? 'Analysis complete' : STAGES[activeIdx]?.label || 'Preparing'}
          </h2>
          <p className="text-sm text-ink-soft">{STAGES[activeIdx]?.body}</p>
        </header>

        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">
            <span>Progress</span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-px bg-rule relative">
            <div
              className="h-px bg-ember absolute top-0 left-0 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <ol className="space-y-2">
          {STAGES.map((s, i) => {
            const isDone = i < activeIdx || processingStage.stage === 'done';
            const isActive = i === activeIdx && processingStage.stage !== 'done';
            return (
              <li
                key={s.id}
                className={`flex items-center gap-3 py-2 px-3 border ${
                  isActive ? 'border-ember bg-ember-soft' : 'border-transparent'
                }`}
              >
                <span className={`w-7 h-7 inline-flex items-center justify-center border ${
                  isDone ? 'border-ink bg-ink text-paper' :
                  isActive ? 'border-ember text-ember' : 'border-rule text-ink-mute'
                }`}>
                  {isDone ? <CheckCircle2 size={12} /> :
                    isActive ? <Loader2 size={12} className="animate-spin" /> :
                    <s.icon size={12} />}
                </span>
                <span className={`text-sm ${isActive || isDone ? 'text-ink' : 'text-ink-mute'}`}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        {processingStage.stage === 'done' && (
          <div className="text-center pt-2">
            <Button onClick={dismissLoading}>Open analysis</Button>
          </div>
        )}
      </div>
    </div>
  );
}
