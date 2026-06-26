import { useSocialData } from '../hooks/useSocialData';
import { useUrlState } from '../app/useUrlState';
import { NetworkGraph } from '../components/graph/NetworkGraph';
import { TemporalReplay } from '../components/insights/TemporalReplay';
import { Eyebrow } from '../components/primitives/Eyebrow';
import { Panel } from '../components/primitives/Panel';
import { formatDate } from '../app/format';
import { useCallback } from 'react';

export function NetworkPage() {
  const { route } = useUrlState();
  const { graphData, filteredData } = useSocialData();
  const networkDatasetId = 'datasetId' in route ? (route as { datasetId: string }).datasetId : null;

  const displayV = filteredData?.vertices || graphData?.vertices || [];
  const displayE = filteredData?.edges || graphData?.edges || [];

  const handleNodeSelect = useCallback((id: string) => {
    if (networkDatasetId) {
      window.location.hash = `#/d/${networkDatasetId}/account/${encodeURIComponent(id)}`;
    }
  }, [networkDatasetId]);

  if (!graphData) return null;

  const dates = graphData.vertices
    .map((v) => v.date)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));
  const min = dates.length ? formatDate(new Date(Math.min(...dates)).toISOString()) : '—';
  const max = dates.length ? formatDate(new Date(Math.max(...dates)).toISOString()) : '—';

  return (
    <div className="px-8 py-10 max-w-[1480px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <Eyebrow accent>Network · Force-directed</Eyebrow>
          <h1
            className="font-display text-4xl text-ink font-light tracking-[-0.02em]"
            style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
          >
            {displayV.length.toLocaleString()} accounts across {min} – {max}
          </h1>
        </div>
      </header>

      <Panel padded={false}>
        <div className="h-[640px]">
          <NetworkGraph
            vertices={graphData.vertices}
            edges={graphData.edges}
            filteredVertices={displayV}
            filteredEdges={displayE}
            onNodeSelect={handleNodeSelect}
            isActive
          />
        </div>
      </Panel>

      <Panel eyebrow={<Eyebrow>Temporal replay</Eyebrow>} title="Step through the campaign">
        <TemporalReplay />
      </Panel>
    </div>
  );
}
