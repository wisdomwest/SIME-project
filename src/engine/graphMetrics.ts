import Graph from 'graphology';
import { Edge, Vertex, NetworkMetrics } from './csvParserEnhanced';

export interface ComputedMetrics extends NetworkMetrics {
  topInfluencers: Vertex[];
  topBetweenness: Vertex[];
  diameter: number;
  avgClusteringCoefficient: number;
  connectedComponents: number;
  reciprocity: number;
}

export function computeSNAMetrics(vertices: Vertex[], edges: Edge[]): ComputedMetrics {
  const graph = new Graph({ multi: false, allowSelfLoops: false });
  const vertexMap = new Map<string, Vertex>();

  // Build graph
  for (const v of vertices) {
    graph.addNode(v.id);
    vertexMap.set(v.id, v);
  }
  for (const e of edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      try {
        if (!graph.hasEdge(e.source, e.target)) {
          graph.addEdge(e.source, e.target, { weight: e.weight });
        }
      } catch (_) {
        // Edge may already exist
      }
    }
  }

  // === DEGREE CENTRALITY ===
  graph.forEachNode((node) => {
    const v = vertexMap.get(node);
    if (v) {
      v.degree = graph.degree(node);
      v.inDegree = graph.inDegree(node);
      v.outDegree = graph.outDegree(node);
    }
  });

  const totalNodes = graph.order;

  // === BETWEENNESS CENTRALITY (Brandes algorithm via graphology) ===
  try {
    const { betweennessCentrality } = require('graphology-metrics/centrality/betweenness');
    const bc = betweennessCentrality(graph, { normalized: true });
    for (const [node, val] of bc) {
      const v = vertexMap.get(node);
      if (v) v.betweenness = val;
    }
  } catch (_) {
    // Fallback: keep parsed values
  }

  // === CLOSENESS CENTRALITY ===
  graph.forEachNode((node) => {
    let sumDist = 0;
    let reachable = 0;
    // Manual BFS approximation for closeness
    const visited = new Set<string>();
    const queue: [string, number][] = [[node, 0]];
    visited.add(node);
    while (queue.length > 0) {
      const [current, dist] = queue.shift()!;
      if (current !== node) {
        sumDist += dist;
        reachable++;
      }
      graph.forEachNeighbor(current, (neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([neighbor, dist + 1]);
        }
      });
    }
    const v = vertexMap.get(node);
    if (v && reachable > 0 && sumDist > 0) {
      v.closeness = reachable / sumDist;
    }
  });

  // === PAGERANK ===
  try {
    const pagerank = computePageRank(graph);
    for (const [node, val] of pagerank) {
      const v = vertexMap.get(node);
      if (v) v.pagerank = val;
    }
  } catch (_) {}

  // === EIGENVECTOR CENTRALITY ===
  try {
    const ev = computeEigenvector(graph);
    for (const [node, val] of ev) {
      const v = vertexMap.get(node);
      if (v) v.eigenvector = val;
    }
  } catch (_) {}

  // === CLUSTERING COEFFICIENT ===
  graph.forEachNode((node) => {
    const neighbors: string[] = [];
    graph.forEachNeighbor(node, (n) => neighbors.push(n));
    if (neighbors.length < 2) {
      const v = vertexMap.get(node);
      if (v) v.clusteringCoefficient = 0;
      return;
    }
    let triangles = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        if (graph.hasEdge(neighbors[i], neighbors[j]) || graph.hasEdge(neighbors[j], neighbors[i])) {
          triangles++;
        }
      }
    }
    const maxTriangles = (neighbors.length * (neighbors.length - 1)) / 2;
    const v = vertexMap.get(node);
    if (v) v.clusteringCoefficient = maxTriangles > 0 ? triangles / maxTriangles : 0;
  });

  // === CONNECTED COMPONENTS ===
  const visited = new Set<string>();
  let components = 0;
  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      components++;
      const stack = [node];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        graph.forEachNeighbor(current, (n) => {
          if (!visited.has(n)) stack.push(n);
        });
      }
    }
  });

  // === RECIPROCITY ===
  let reciprocalEdges = 0;
  graph.forEachEdge((_edge, _attrs, source, target) => {
    try {
      if (graph.hasEdge(target, source)) reciprocalEdges++;
    } catch (_) {}
  });
  const reciprocity = graph.size > 0 ? reciprocalEdges / graph.size : 0;

  // === DIAMETER (approximate via BFS from top degree nodes) ===
  let diameter = 0;
  const topNodes = [...vertexMap.values()]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
    .map(v => v.id);
  for (const start of topNodes) {
    const dist = new Map<string, number>();
    const q: string[] = [start];
    dist.set(start, 0);
    while (q.length > 0) {
      const cur = q.shift()!;
      const d = dist.get(cur)!;
      graph.forEachNeighbor(cur, (n) => {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          q.push(n);
          if (d + 1 > diameter) diameter = d + 1;
        }
      });
    }
  }

  // === SUMMARY METRICS ===
  const avgCC = vertices.length > 0
    ? vertices.reduce((s, v) => s + v.clusteringCoefficient, 0) / vertices.length
    : 0;

  const sortedByDegree = [...vertices].sort((a, b) => b.degree - a.degree);
  const sortedByBetweenness = [...vertices].sort((a, b) => b.betweenness - a.betweenness);

  const posN = vertices.filter(v => v.sentiment === 'Pos').length;
  const neuN = vertices.filter(v => v.sentiment === 'Neu').length;
  const negN = vertices.filter(v => v.sentiment === 'Neg').length;

  return {
    totalVertices: totalNodes,
    totalEdges: graph.size,
    density: totalNodes > 1 ? (2 * graph.size) / (totalNodes * (totalNodes - 1)) : 0,
    diameter,
    avgClusteringCoefficient: avgCC,
    connectedComponents: components,
    reciprocity,
    avgDegree: totalNodes > 0 ? graph.size * 2 / totalNodes : 0,
    sentimentDistribution: { Pos: posN, Neu: neuN, Neg: negN },
    topInfluencers: sortedByDegree.slice(0, 10),
    topBetweenness: sortedByBetweenness.slice(0, 10),
  };
}

// === PAGERANK (iterative implementation) ===
function computePageRank(graph: Graph, damping = 0.85, iterations = 50): Map<string, number> {
  const ranks = new Map<string, number>();
  const n = graph.order;
  const initRank = 1 / n;

  graph.forEachNode((node) => ranks.set(node, initRank));

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();
    const danglingSum = (1 - damping) / n;

    graph.forEachNode((node) => {
      let sum = 0;
      graph.forEachInNeighbor(node, (neighbor) => {
        const outDeg = graph.outDegree(neighbor);
        if (outDeg > 0) {
          sum += (ranks.get(neighbor) || 0) / outDeg;
        }
      });
      newRanks.set(node, danglingSum + damping * sum);
    });

    // Normalize
    let total = 0;
    for (const v of newRanks.values()) total += v;
    if (total > 0) {
      for (const [node, val] of newRanks) newRanks.set(node, val / total);
    }

    // Copy back
    for (const [node, val] of newRanks) ranks.set(node, val);
  }

  return ranks;
}

// === EIGENVECTOR CENTRALITY (power iteration) ===
function computeEigenvector(graph: Graph, iterations = 50): Map<string, number> {
  const scores = new Map<string, number>();
  graph.forEachNode((node) => scores.set(node, 1));

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();
    graph.forEachNode((node) => {
      let sum = 0;
      graph.forEachNeighbor(node, (neighbor) => {
        sum += scores.get(neighbor) || 0;
      });
      newScores.set(node, sum);
    });
    // Normalize
    let norm = 0;
    for (const v of newScores.values()) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (const [node, val] of newScores) scores.set(node, val / norm);
    }
  }

  return scores;
}
