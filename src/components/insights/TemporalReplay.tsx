import { useEffect, useMemo, useState } from 'react';
import { useSocialData } from '../../hooks/useSocialData';
import { Button } from '../primitives/Button';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { formatDateISO, parseDate } from '../../app/format';

const SPEEDS = [0.5, 1, 2, 4];
const METRICS = [
  { id: 'volume', label: 'Volume' },
  { id: 'sentiment', label: 'Sentiment drift' },
  { id: 'bots', label: 'Bot activity' },
] as const;

type MetricId = typeof METRICS[number]['id'];

export function TemporalReplay() {
  const { graphData, updateFilters } = useSocialData();
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [metric, setMetric] = useState<MetricId>('volume');

  // Build day buckets from all vertices that have dates
  const days = useMemo(() => {
    if (!graphData) return [] as string[];
    const set = new Set<string>();
    graphData.vertices.forEach((v) => {
      const parsed = parseDate(v.date);
      if (parsed) set.add(formatDateISO(parsed));
    });
    return [...set].sort();
  }, [graphData]);

  const series = useMemo(() => {
    if (!graphData) return [] as { day: string; value: number }[];
    const byDay = new Map<string, { vol: number; pos: number; neg: number; bot: number; total: number }>();
    days.forEach((d) => byDay.set(d, { vol: 0, pos: 0, neg: 0, bot: 0, total: 0 }));
    graphData.vertices.forEach((v) => {
      const parsed = parseDate(v.date);
      if (!parsed) return;
      const d = formatDateISO(parsed);
      const entry = byDay.get(d);
      if (!entry) return;
      entry.vol++;
      entry.total++;
      if (v.sentiment === 'Pos') entry.pos++;
      else if (v.sentiment === 'Neg') entry.neg++;
      if (v.isBot) entry.bot++;
    });
    return days.map((d) => {
      const e = byDay.get(d)!;
      let value = 0;
      if (metric === 'volume') value = e.vol;
      else if (metric === 'sentiment') value = e.total ? (e.pos - e.neg) / e.total : 0;
      else if (metric === 'bots') value = e.total ? e.bot / e.total : 0;
      return { day: d, value };
    });
  }, [graphData, days, metric]);

  // Precompute visible node count for each day to avoid filtering all vertices on every render/tick
  const visibleCounts = useMemo(() => {
    if (!graphData || days.length === 0) return [] as number[];
    const dayIndices = new Map<string, number>();
    days.forEach((day, idx) => dayIndices.set(day, idx));

    const counts = new Array(days.length).fill(0);
    graphData.vertices.forEach((v) => {
      const parsed = parseDate(v.date);
      if (!parsed) return;
      const d = formatDateISO(parsed);
      const idx = dayIndices.get(d);
      if (idx !== undefined) {
        counts[idx]++;
      }
    });

    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
      sum += counts[i];
      counts[i] = sum;
    }
    return counts;
  }, [graphData, days]);

  // On first load, start at the beginning and show all nodes (no date cap)
  useEffect(() => {
    if (days.length) {
      setReplayIdx(days.length - 1);
      // Clear date filter so everything shows
      updateFilters({ dateRange: ['', ''] });
    }
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the playhead moves, ONLY update the graph filter when NOT autoplaying.
  // During playback, the chart animates smoothly without reloading the graph.
  // The final position is flushed to the graph when play stops.
  useEffect(() => {
    if (replayIdx === null || days.length === 0) return;
    if (playing) return; // <-- skip during playback — too janky
    const cutoff = days[replayIdx];
    updateFilters({ dateRange: ['', cutoff] });
  }, [replayIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush the last playhead position to the graph when playback stops
  useEffect(() => {
    if (replayIdx !== null && !playing && days.length > 0) {
      const cutoff = days[replayIdx];
      updateFilters({ dateRange: ['', cutoff] });
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance when playing
  useEffect(() => {
    if (!playing || replayIdx === null) return;
    const t = setTimeout(() => {
      setReplayIdx((i) => {
        if (i === null) return null;
        if (i >= days.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 400 / speed);
    return () => clearTimeout(t);
  }, [playing, replayIdx, speed, days.length]);

  const handleReset = () => {
    setPlaying(false);
    setReplayIdx(0);
  };

  if (days.length === 0) {
    return (
      <p className="text-sm text-ink-soft italic">
        No dates in this dataset — temporal replay needs timestamps.
      </p>
    );
  }

  const max = Math.max(...series.map((s) => Math.abs(s.value)), 1);
  const currentDay = replayIdx !== null ? days[replayIdx] : '';
  const visibleCount = replayIdx !== null && visibleCounts[replayIdx] !== undefined ? visibleCounts[replayIdx] : 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button onClick={() => setPlaying(!playing)} size="sm">
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw size={12} /> Reset
          </Button>
        </div>

        <div className="flex border border-rule">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1 text-xs font-mono ${
                speed === s ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-2'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex border border-rule">
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`px-3 py-1 text-xs ${
                metric === m.id ? 'bg-ember-soft text-ember' : 'text-ink-soft hover:bg-paper-2'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto text-right">
          <div className="font-mono text-xs text-ink-soft">
            {currentDay} · day {replayIdx !== null ? replayIdx + 1 : '–'} of {days.length}
          </div>
          <div className="font-mono text-[10px] text-ink-mute">
            {visibleCount.toLocaleString()} accounts visible
          </div>
        </div>
      </div>

      {/* Timeline chart */}
      <div className="relative">
        <svg viewBox={`0 0 ${series.length * 8} 80`} className="w-full h-32" preserveAspectRatio="none">
          {/* Zero line */}
          <line x1="0" y1="40" x2={series.length * 8} y2="40" stroke="var(--color-rule)" strokeWidth="0.5" />
          {(() => {
            const w = series.length * 8;
            const points = series.map((s, i) => {
              const x = i * 8 + 4;
              const y = 40 - (s.value / max) * 36;
              return { x, y };
            });
            const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
            const area = `${path} L${w},40 L0,40 Z`;
            return (
              <>
                <path d={area} fill="var(--color-ember-soft)" />
                <path d={path} fill="none" stroke="var(--color-ember)" strokeWidth="1" />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === replayIdx ? 3 : 0.5}
                    fill={i === replayIdx ? 'var(--color-ember-strong)' : 'var(--color-ink-soft)'}
                  />
                ))}
                {/* Playhead */}
                {replayIdx !== null && (
                  <line
                    x1={replayIdx * 8 + 4}
                    x2={replayIdx * 8 + 4}
                    y1="0"
                    y2="80"
                    stroke="var(--color-ink)"
                    strokeWidth="1"
                  />
                )}
              </>
            );
          })()}
        </svg>
        <div className="flex justify-between text-[10px] font-mono text-ink-mute mt-1">
          <span>{days[0]}</span>
          <span>{days[days.length - 1]}</span>
        </div>
      </div>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={days.length - 1}
        value={replayIdx ?? days.length - 1}
        onChange={(e) => { setPlaying(false); setReplayIdx(parseInt(e.target.value)); }}
        className="w-full accent-ember"
      />

      {/* Warning: filtering is live */}
      <p className="text-[10px] text-ink-mute italic">
        Scrubbing adjusts the graph's date filter. Reset to show all accounts again.
      </p>
    </div>
  );
}
