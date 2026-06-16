import { usePythonBackend } from '../../hooks/usePythonBackend';
import { useSocialData } from '../../hooks/useSocialData';
import { getConfig } from '../../services/llmService';

export function StatusLine({ hasData }: { hasData: boolean }) {
  const backend = usePythonBackend();
  const { graphData, processingStage } = useSocialData();
  const config = getConfig();

  const statusDot =
    backend.status === 'up' ? 'bg-signal-pos' :
    backend.status === 'down' ? 'bg-ember' : 'bg-ink-mute';
  const statusLabel =
    backend.status === 'up' ? 'Python engine · running' :
    backend.status === 'down' ? 'Python engine · offline' : 'Python engine · connecting';

  return (
    <footer className="h-7 border-t border-rule bg-paper-2 flex items-center justify-between px-6 text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-mute shrink-0">
      <div className="flex items-center gap-5">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} aria-hidden />
          {statusLabel}
        </span>
        {hasData && graphData && (
          <span className="font-mono normal-case tracking-normal text-ink-soft">
            {graphData.vertices.length.toLocaleString()} accounts · {graphData.edges.length.toLocaleString()} edges
          </span>
        )}
        {processingStage.stage !== 'idle' && processingStage.stage !== 'done' && (
          <span className="font-mono normal-case tracking-normal text-ember">
            {processingStage.stage} · {Math.round(processingStage.progress)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-5">
        {config && (
          <span className="font-mono normal-case tracking-normal">
            {config.provider} · {config.model}
          </span>
        )}
        <span>SIMElab Africa · USIU-Africa</span>
      </div>
    </footer>
  );
}
