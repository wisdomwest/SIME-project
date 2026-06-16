import { ReactNode } from 'react';
import { usePythonBackend, BackendStatus } from '../../hooks/usePythonBackend';
import { Eyebrow } from '../primitives/Eyebrow';
import { Button } from '../primitives/Button';
import { Terminal, ArrowUpRight, Loader2 } from 'lucide-react';

export function BackendOffline({ feature, backendStatus, backendRefresh }: { feature: string; backendStatus: BackendStatus; backendRefresh?: () => Promise<void> }) {
  if (backendStatus === 'up') return null;

  // When loading, show a minimal spinner — avoids the "sleeping" flash
  if (backendStatus === 'loading') {
    return (
      <div className="flex items-center justify-center py-32 text-ink-soft">
        <Loader2 size={18} className="animate-spin mr-3" />
        <span className="text-sm">Connecting to Python engine…</span>
      </div>
    );
  }

  // Down — show the setup instructions
  return (
    <div className="max-w-2xl mx-auto my-16 border border-rule bg-paper-2 p-10 space-y-5">
      <Eyebrow accent>Python engine</Eyebrow>
      <h2
        className="font-display text-3xl text-ink font-light tracking-[-0.02em]"
        style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
      >
        The {feature} module is sleeping
      </h2>
      <p className="text-sm text-ink-soft leading-relaxed max-w-lg">
        The browser pipeline (network metrics, community detection, bot signals, narratives) is fully
        active. The deeper {feature} pass runs in Python — k-means clustering, five-signal disinformation
        scoring, structural-hole analysis. Start it to enable this view.
      </p>
      <div className="border border-ink bg-paper p-4 font-mono text-xs text-ink">
        <div className="flex items-center gap-2 text-ink-mute mb-1.5">
          <Terminal size={12} /> From the project root
        </div>
        <code className="text-ember">npm run python</code>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button onClick={backendRefresh}>
          Re-probe backend
        </Button>
        <a
          href="https://github.com/Vivnjoroge/SIME-project"
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-ink-mute hover:text-ink transition-colors inline-flex items-center gap-1"
        >
          Setup notes <ArrowUpRight size={11} />
        </a>
      </div>
    </div>
  );
}

export function PythonOnlyWrap({ feature, children }: { feature: string; children: ReactNode }) {
  const { status, refresh } = usePythonBackend();
  if (status === 'up') return <>{children}</>;
  return <BackendOffline feature={feature} backendStatus={status} backendRefresh={refresh} />;
}
