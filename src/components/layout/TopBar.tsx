import { useUrlState } from '../../app/useUrlState';
import { useSocialData } from '../../hooks/useSocialData';
import { Button } from '../primitives/Button';
import { exportResultsCSV, copyShareUrl } from '../../services/exportService';
import { Download, Share2, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from './ThemeToggle';

export function TopBar({ hasData }: { hasData: boolean }) {
  const { route, navigate } = useUrlState();
  const { graphData, computedMetrics } = useSocialData();
  const [shareCopied, setShareCopied] = useState(false);

  const datasetId = 'datasetId' in route ? route.datasetId : null;
  const goToLanding = () => {
    window.location.hash = '#/';
  };
  const isLanding = route.name === 'landing';

  const handleShare = async () => {
    await copyShareUrl();
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1500);
  };


  return (
    <header className="h-16 border-b border-rule bg-paper flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={goToLanding}
          className="flex items-center gap-3 text-left group"
          aria-label="Go to landing page"
        >
          <div className="w-9 h-9 border border-ink flex items-center justify-center font-display text-base font-light group-hover:bg-ink group-hover:text-paper transition-colors">
            S
          </div>
          <div>
            <h1 className="font-display text-base text-ink font-light leading-none tracking-[-0.01em]">
              SIMElab Data Explorer
            </h1>
            <p className="text-[10px] text-ink-mute mt-0.5 uppercase tracking-[0.18em] font-semibold">
              USIU-Africa · Social Intelligence
            </p>
          </div>
        </button>
      </div>

      <nav className="hidden md:flex items-center gap-1">
        {hasData && datasetId && (
          <>
            <NavLink
              label="Overview"
              active={route.name === 'overview'}
              onClick={() => navigate({ name: 'overview', datasetId })}
            />
            <NavLink
              label="Network"
              active={route.name === 'network'}
              onClick={() => navigate({ name: 'network', datasetId })}
            />
            <NavLink
              label="Sentiment"
              active={route.name === 'sentiment'}
              onClick={() => navigate({ name: 'sentiment', datasetId })}
            />
            <NavLink
              label="Disinfo"
              active={route.name === 'disinfo'}
              onClick={() => navigate({ name: 'disinfo', datasetId })}
            />
            <NavLink
              label="Hashtags"
              active={route.name === 'hashtags'}
              onClick={() => navigate({ name: 'hashtags', datasetId })}
            />
            <NavLink
              label="Censorship"
              active={route.name === 'censorship'}
              onClick={() => navigate({ name: 'censorship', datasetId })}
            />
            <NavLink
              label="Drift"
              active={route.name === 'drift'}
              onClick={() => navigate({ name: 'drift', datasetId })}
            />
            <NavLink
              label="Commercial"
              active={route.name === 'commercial'}
              onClick={() => navigate({ name: 'commercial', datasetId })}
            />
            <NavLink
              label="Report"
              active={route.name === 'report'}
              onClick={() => navigate({ name: 'report', datasetId })}
            />
          </>
        )}
        <NavLink
          label="Docs"
          active={false}
          onClick={() => window.location.hash = '#/docs'}
        />

        {!hasData && !isLanding && <span className="text-xs text-ink-mute">Loading…</span>}
      </nav>

      <div className="flex items-center gap-2">
        {hasData && graphData && (
          <>
            <Button variant="ghost" size="sm" onClick={handleShare}>
              <Share2 size={12} />
              {shareCopied ? 'Copied' : 'Share view'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportResultsCSV(graphData, computedMetrics)}
            >
              <Download size={12} />
              Export CSV
            </Button>
          </>
        )}
        <ThemeToggle className="w-8 h-8 flex items-center justify-center border border-rule hover:border-ink text-ink-mute hover:text-ink transition-colors mr-1 cursor-pointer" />
        <a
          href="https://simelab.africa"
          target="_blank"
          rel="noreferrer noopener"
          className="text-ink-mute hover:text-ink transition-colors"
          aria-label="Open SIMElab website"
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </header>
  );
}

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
        active ? 'text-ink border-ember' : 'text-ink-mute border-transparent hover:text-ink-soft'
      }`}
    >
      {label}
    </button>
  );
}
