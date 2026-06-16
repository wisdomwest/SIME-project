interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  fill?: boolean;
  tone?: 'ember' | 'pos' | 'neg' | 'ink';
}

const toneHex: Record<NonNullable<SparklineProps['tone']>, { stroke: string; fill: string }> = {
  ember: { stroke: 'var(--color-ember)', fill: 'var(--color-ember-soft)' },
  pos: { stroke: 'var(--color-signal-pos)', fill: 'var(--color-signal-pos-soft)' },
  neg: { stroke: 'var(--color-signal-neg)', fill: 'var(--color-signal-neg-soft)' },
  ink: { stroke: 'var(--color-ink)', fill: 'var(--color-rule)' },
};

export function Sparkline({
  values,
  width = 80,
  height = 24,
  fill = true,
  tone = 'ember',
}: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const c = toneHex[tone];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      {fill && <polygon points={areaPoints} fill={c.fill} />}
      <polyline
        points={points}
        fill="none"
        stroke={c.stroke}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
