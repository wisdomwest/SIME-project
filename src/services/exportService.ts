/**
 * exportService — CSV export of vertices / metrics, plus a shareable URL
 * helper. We avoid external libraries.
 */

import { GraphData, Vertex } from '../engine/csvParserEnhanced';
import { ComputedMetrics } from '../engine/graphMetrics';

const COLUMNS: { header: string; pick: (v: Vertex) => string | number }[] = [
  { header: 'id', pick: (v) => v.id },
  { header: 'label', pick: (v) => v.label },
  { header: 'cluster', pick: (v) => v.cluster },
  { header: 'cluster_label', pick: (v) => v.clusterLabel },
  { header: 'sentiment', pick: (v) => v.sentiment },
  { header: 'followers', pick: (v) => v.followers },
  { header: 'tweets', pick: (v) => v.retweets },
  { header: 'favorites', pick: (v) => v.favorites },
  { header: 'degree', pick: (v) => v.degree },
  { header: 'in_degree', pick: (v) => v.inDegree },
  { header: 'out_degree', pick: (v) => v.outDegree },
  { header: 'betweenness', pick: (v) => v.betweenness.toFixed(6) },
  { header: 'closeness', pick: (v) => v.closeness.toFixed(6) },
  { header: 'eigenvector', pick: (v) => v.eigenvector.toFixed(6) },
  { header: 'pagerank', pick: (v) => v.pagerank.toFixed(6) },
  { header: 'clustering_coefficient', pick: (v) => v.clusteringCoefficient.toFixed(6) },
  { header: 'is_bot', pick: (v) => (v.isBot ? 1 : 0) },
  { header: 'bot_score', pick: (v) => v.botScore.toFixed(4) },
  { header: 'platform', pick: (v) => v.platform },
  { header: 'topic', pick: (v) => v.topic },
  { header: 'date', pick: (v) => v.date },
  { header: 'hashtags', pick: (v) => v.hashtags.join(' ') },
];

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportResultsCSV(graphData: GraphData, _metrics: ComputedMetrics | null) {
  const header = COLUMNS.map((c) => c.header).join(',');
  const lines = graphData.vertices.map((v) =>
    COLUMNS.map((c) => csvEscape(String(c.pick(v) ?? ''))).join(','),
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `simelab_metrics_${stamp()}.csv`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

export async function copyShareUrl(): Promise<boolean> {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}
