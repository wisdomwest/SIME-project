import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { Vertex, Edge } from './csvParserEnhanced';

export function detectCommunities(vertices: Vertex[], edges: Edge[]): void {
  const graph = new Graph({ multi: false, allowSelfLoops: false });

  for (const v of vertices) graph.addNode(v.id);
  for (const e of edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      try {
        if (!graph.hasEdge(e.source, e.target)) {
          graph.addEdge(e.source, e.target, { weight: e.weight });
        }
      } catch (_) {}
    }
  }

  if (graph.order < 3) {
    vertices.forEach(v => { v.cluster = 0; v.clusterLabel = 'Community 1'; });
    return;
  }

  try {
    const communities = louvain(graph, {
      getEdgeWeight: 'weight',
      resolution: 1.0,
      rng: () => Math.random(),
    });

    // Assign cluster IDs
    const clusterMap = new Map<string, number>();
    for (const [node, cluster] of Object.entries(communities)) {
      clusterMap.set(node, cluster as number);
    }

    // Label clusters by most common sentiment + top node
    const clusterSizes = new Map<number, number>();
    const clusterSentiment = new Map<number, Map<string, number>>();
    const clusterTopNode = new Map<number, string>();

    for (const v of vertices) {
      const cid = clusterMap.get(v.id) ?? 0;
      v.cluster = cid;
      clusterSizes.set(cid, (clusterSizes.get(cid) || 0) + 1);
      if (!clusterSentiment.has(cid)) clusterSentiment.set(cid, new Map());
      const sMap = clusterSentiment.get(cid)!;
      sMap.set(v.sentiment, (sMap.get(v.sentiment) || 0) + 1);
      const currentTop = clusterTopNode.get(cid);
      const currentV = vertices.find(x => x.id === currentTop);
      if (!currentV || v.degree > currentV.degree) {
        clusterTopNode.set(cid, v.id);
      }
    }

    for (const v of vertices) {
      const cid = v.cluster;
      const topNode = clusterTopNode.get(cid) || `Cluster ${cid}`;
      const sMap = clusterSentiment.get(cid);
      let dominantSent = 'Mixed';
      if (sMap) {
        const sorted = [...sMap.entries()].sort((a, b) => b[1] - a[1]);
        dominantSent = sorted[0]?.[0] || 'Mixed';
      }
      const sentLabel = dominantSent === 'Pos' ? 'Positive' : dominantSent === 'Neg' ? 'Negative' : 'Neutral';
      v.clusterLabel = `Community ${cid + 1}: ${topNode} (${sentLabel})`;
    }
  } catch (e) {
    // Fallback: assign all to cluster 0
    vertices.forEach(v => { v.cluster = 0; v.clusterLabel = 'Community 1'; });
  }
}
