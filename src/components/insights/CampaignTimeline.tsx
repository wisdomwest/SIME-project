import { useMemo } from 'react';
import { useSocialData } from '../../hooks/useSocialData';
import { AIInsights } from '../../engine/aiInsights';

export function CampaignTimeline({ insights }: { insights: AIInsights }) {
  const { graphData, computedMetrics } = useSocialData();

  // Build per-day counts from vertex dates.
  const series = useMemo(() => {
    if (!graphData) return [];
    const counts = new Map<string, number>();
    graphData.vertices.forEach((v) => {
      if (!v.date) return;
      const day = v.date.split('T')[0].split(' ')[0];
      counts.set(day, (counts.get(day) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graphData]);

  const max = useMemo(() => {
    return Math.max(...series.map(([, c]) => c), 1);
  }, [series]);

  // Top narratives (3-5)
  const narratives = insights.keyNarratives.slice(0, 5);

  // Suspicious accounts
  const suspicious = insights.suspiciousAccounts.slice(0, 5);

  if (!graphData || !computedMetrics) return null;

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-3">
          Volume by day
        </h4>
        <div className="flex items-end gap-px h-16 border-b border-rule-l">
          {series.map(([day, c]) => (
            <div
              key={day}
              className="flex-1 bg-ember hover:bg-ember-strong transition-colors"
              style={{ height: `${(c / max) * 100}%`, minHeight: '2px' }}
              title={`${day} · ${c} posts`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] font-mono text-ink-mute mt-1.5">
          <span>{series[0]?.[0]}</span>
          <span>{series[series.length - 1]?.[0]}</span>
        </div>
      </div>

      {narratives.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-3">
            Top narratives
          </h4>
          <ul className="space-y-2.5">
            {narratives.map((n, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-[10px] text-ink-mute w-5 pt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm text-ink leading-snug" style={{ fontVariationSettings: "'opsz' 24, 'SOFT' 100" }}>
                      {n.theme}
                    </span>
                    <span className={`text-[9px] font-mono px-1 py-px uppercase tracking-wider ${
                      n.dominantSentiment === 'Positive' ? 'text-signal-pos' :
                      n.dominantSentiment === 'Negative' ? 'text-signal-neg' : 'text-ink-mute'
                    }`}>{n.dominantSentiment}</span>
                  </div>
                  {n.examplePosts[0] && (
                    <p className="text-xs text-ink-soft leading-relaxed mt-1 line-clamp-2">
                      {n.examplePosts[0].slice(0, 140)}
                    </p>
                  )}
                </div>
                <span className="font-mono text-[10px] text-ink-mute">{n.postCount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suspicious.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute mb-3">
            Suspicious accounts
          </h4>
          <ul className="space-y-2">
            {suspicious.map((acc) => (
              <li key={acc.id} className="flex items-center gap-3">
                <span className="w-9 h-9 inline-flex items-center justify-center border border-signal-neg text-signal-neg text-[10px] font-mono">
                  {Math.round(acc.score * 100)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">@{acc.label}</p>
                  <p className="text-[10px] text-ink-mute truncate">{acc.reasons[0]}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {narratives.length === 0 && suspicious.length === 0 && (
        <p className="text-xs text-ink-mute italic">
          No text content in this dataset — narrative detection requires tweet/post text.
        </p>
      )}
    </div>
  );
}
