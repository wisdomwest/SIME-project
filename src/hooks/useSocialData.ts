import { useState, useCallback, useMemo, createContext, useContext, ReactNode, createElement, useEffect, useRef } from 'react';
import Graph from 'graphology';
import { Edge, Vertex, GraphData, parseNodeXLFile } from '../engine/csvParserEnhanced';
import { ComputedMetrics, computeSNAMetrics } from '../engine/graphMetrics';
import { detectCommunities } from '../engine/communityDetection';
import { AIInsights, analyzeAI } from '../engine/aiInsights';
import { uploadFile, getSentiment, getDisinformation } from '../services/pythonApi';
import { loadSession, saveSession, clearSession } from '../services/db';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Compute only the topology-level stats (components, reciprocity, density)
 *  from raw vertex/edge arrays without re-running full centrality. */
function computeGraphTopology(vertices: Vertex[], edges: Edge[]): {
  connectedComponents: number;
  reciprocity: number;
  density: number;
  n: number;
  size: number;
} {
  const g = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  
  // Find all nodes that participate in at least one edge
  const activeNodes = new Set<string>();
  for (const e of edges) {
    activeNodes.add(e.source);
    activeNodes.add(e.target);
  }

  // Only merge nodes that are active (participate in edges)
  for (const v of vertices) {
    if (activeNodes.has(v.id)) {
      g.mergeNode(v.id);
    }
  }

  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
      try { g.addEdge(e.source, e.target); } catch (_) {}
    }
  }

  // Weakly-connected components via BFS ignoring edge direction
  const visited = new Set<string>();
  let components = 0;
  g.forEachNode((node) => {
    if (!visited.has(node)) {
      components++;
      const stack = [node];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        // forEachNeighbor visits both in- and out-neighbours
        g.forEachNeighbor(cur, (n) => { if (!visited.has(n)) stack.push(n); });
      }
    }
  });

  // Reciprocity = fraction of edges that have a reverse edge
  let reciprocal = 0;
  g.forEachEdge((_e, _a, src, tgt) => {
    if (g.hasEdge(tgt, src)) reciprocal++;
  });
  const size = g.size;
  const n = g.order;
  const reciprocity = size > 0 ? reciprocal / size : 0;
  // Directed density: edges / (n*(n-1))
  const density = n > 1 ? size / (n * (n - 1)) : 0;

  return { connectedComponents: components, reciprocity, density, n, size };
}

export type { AIInsights } from '../engine/aiInsights';
export type { GraphData } from '../engine/csvParserEnhanced';
export type { ComputedMetrics } from '../engine/graphMetrics';

export interface FilterState {
  keyword: string;
  sentiment: string[];
  platform: string;
  topic: string;
  minFollowers: number;
  minDegree: number;
  sortBy: string;
  dateRange: [string, string];
  selectedCluster: number;
}

export type ProcessingStage = 'idle' | 'parsing' | 'metrics' | 'communities' | 'graph' | 'ai' | 'done';
export type ProcessingProgress = { stage: ProcessingStage; progress: number };

// Yield to the browser to keep UI responsive
function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const useSocialDataState = () => {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [computedMetrics, setComputedMetrics] = useState<ComputedMetrics | null>(null);
  const [aiInsights, setAIInsights] = useState<AIInsights | null>(null);
  const [driftData, setDriftData] = useState<import('../services/pythonApi').DriftData | null>(null);
  const [pythonDatasetId, setPythonDatasetId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingProgress>({ stage: 'idle', progress: 0 });

  const [filters, setFilters] = useState<FilterState>({
    keyword: '',
    sentiment: ['Pos', 'Neu', 'Neg'],
    platform: 'All Platforms',
    topic: 'All Topics',
    minFollowers: 0,
    minDegree: 0,
    sortBy: 'Degree',
    dateRange: ['', ''],
    selectedCluster: -1,
  });

  // ─── IndexedDB persistence ─────────────────────────────────────────
  // Restore saved session on first mount (only if no file is being processed)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    loadSession().then((saved) => {
      if (!saved || !saved.graphData) return;
      setGraphData(saved.graphData as GraphData);
      if (saved.computedMetrics) setComputedMetrics(saved.computedMetrics as ComputedMetrics);
      if (saved.aiInsights) setAIInsights(saved.aiInsights as AIInsights);
      if (saved.driftData) setDriftData(saved.driftData as import('../services/pythonApi').DriftData);
      if (saved.chatMessages) setChatMessages(saved.chatMessages as ChatMessage[]);
      if (saved.aiAnalysisResult !== undefined) setAiAnalysisResult(saved.aiAnalysisResult);
      if (saved.pythonDatasetId) setPythonDatasetId(saved.pythonDatasetId);
    });
  }, []);

  // ─── Re-fetch Python sentiment after IndexedDB restore ─────────────
  // When state is restored from IndexedDB (page refresh), the per-vertex
  // sentiment labels and sentimentDistribution may still hold CSV-file
  // defaults (0/0/100). Re-fetch the Python k-means results to correct them.
  const pyRestoreRef = useRef(false);
  useEffect(() => {
    if (!pythonDatasetId) return;
    if (pyRestoreRef.current) return;
    pyRestoreRef.current = true;
    // Small delay to let all restored state settle
    const t = setTimeout(async () => {
      try {
        const [sentiment, disinfo] = await Promise.all([
          getSentiment(pythonDatasetId),
          getDisinformation(pythonDatasetId),
        ]);
        const sentimentMap = new Map<string, 'Pos' | 'Neu' | 'Neg'>();
        sentiment.labels.forEach((l) => {
          sentimentMap.set(l.node, l.sentiment as 'Pos' | 'Neu' | 'Neg');
        });
        const disinfoMap = new Map<string, { score: number; isBot: boolean }>();
        disinfo.scores.forEach((s) => {
          disinfoMap.set(s.node, {
            score: s.disinfo_score,
            isBot: s.risk_level === 'likely_disinfo' || s.risk_level === 'suspicious',
          });
        });
        setGraphData((prev) => {
          if (!prev) return null;
          const updatedVertices = prev.vertices.map((v) => {
            const pySent = sentimentMap.get(v.id);
            const pyDis = disinfoMap.get(v.id);
            return {
              ...v,
              sentiment: pySent !== undefined ? pySent : v.sentiment,
              botScore: pyDis !== undefined ? pyDis.score : v.botScore,
              isBot: pyDis !== undefined ? pyDis.isBot : v.isBot,
            };
          });
          return { ...prev, vertices: updatedVertices };
        });
        setComputedMetrics((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            sentimentDistribution: {
              Pos: sentiment.clusters.Pos,
              Neu: sentiment.clusters.Neu,
              Neg: sentiment.clusters.Neg,
            },
          };
        });
      } catch (_err) {
        // Python backend may be unavailable on first restore — that's fine
      }
    }, 500);
    return () => clearTimeout(t);
  }, [pythonDatasetId]);

  // Debounced save — persists latest state to IndexedDB 1s after last change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSession({
        graphData,
        computedMetrics,
        aiInsights,
        driftData,
        chatMessages,
        aiAnalysisResult,
        pythonDatasetId,
      });
    }, 1000);
  }, [graphData, computedMetrics, aiInsights, driftData, chatMessages, aiAnalysisResult, pythonDatasetId]);

  // Auto-save when state changes
  useEffect(() => { scheduleSave(); }, [scheduleSave]);

  const processFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setDriftData(null);
    setChatMessages([]);
    setAiAnalysisResult(null);
    clearSession();
    setProcessingStage({ stage: 'parsing', progress: 5 });

    try {
      // Stage 1: Parse file
      const parsed = await parseNodeXLFile(file);
      await yieldToBrowser();
      setProcessingStage({ stage: 'metrics', progress: 25 });

      // Stage 2: Compute SNA metrics (heaviest — yield periodically)
      const metrics = await computeMetricsAsync(parsed, (pct) => {
        setProcessingStage({ stage: 'metrics', progress: 25 + Math.round(pct * 0.35) });
      });
      await yieldToBrowser();
      setProcessingStage({ stage: 'communities', progress: 60 });

      // Stage 3: Community detection
      await detectCommunitiesAsync(parsed);
      await yieldToBrowser();
      setProcessingStage({ stage: 'ai', progress: 75 });

      // Stage 4: AI analysis
      const ai = await analyzeAIAsync(parsed);
      await yieldToBrowser();
      setProcessingStage({ stage: 'graph', progress: 92 });

      setGraphData(parsed);
      setComputedMetrics(metrics);
      setAIInsights(ai);

      setProcessingStage({ stage: 'done', progress: 100 });
      await new Promise(r => setTimeout(r, 600)); // Brief pause so user sees "done"

      // Stage 5 (best-effort): hand the same file to the Python backend so
      // the 5 deep-analysis pages light up. Failure is non-fatal — the
      // in-browser pipeline is already complete.
      uploadFile(file)
        .then(async (summary) => {
          if (summary?.dataset_id) {
            setPythonDatasetId(summary.dataset_id);

            // Fetch actual calculated sentiment and disinformation labels from the backend
            try {
              const [sentiment, disinfo] = await Promise.all([
                getSentiment(summary.dataset_id),
                getDisinformation(summary.dataset_id),
              ]);

              const sentimentMap = new Map<string, 'Pos' | 'Neu' | 'Neg'>();
              sentiment.labels.forEach((l) => {
                sentimentMap.set(l.node, l.sentiment as 'Pos' | 'Neu' | 'Neg');
              });

              const disinfoMap = new Map<string, { score: number; isBot: boolean }>();
              disinfo.scores.forEach((s) => {
                disinfoMap.set(s.node, {
                  score: s.disinfo_score,
                  isBot: s.risk_level === 'likely_disinfo' || s.risk_level === 'suspicious',
                });
              });

              setGraphData((prev) => {
                if (!prev) return null;
                const updatedVertices = prev.vertices.map((v) => {
                  const pySent = sentimentMap.get(v.id);
                  const pyDis = disinfoMap.get(v.id);
                  return {
                    ...v,
                    sentiment: pySent !== undefined ? pySent : v.sentiment,
                    botScore: pyDis !== undefined ? pyDis.score : v.botScore,
                    isBot: pyDis !== undefined ? pyDis.isBot : v.isBot,
                  };
                });
                return { ...prev, vertices: updatedVertices };
              });

              // Synchronize the computed SNA metrics sentiment distribution with the Python backend k-means counts
              setComputedMetrics((prevMetrics) => {
                if (!prevMetrics) return null;
                return {
                  ...prevMetrics,
                  sentimentDistribution: {
                    Pos: sentiment.clusters.Pos,
                    Neu: sentiment.clusters.Neu,
                    Neg: sentiment.clusters.Neg,
                  },
                };
              });
            } catch (err) {
              console.warn("Failed to synchronize calculations with Python backend:", err);
            }
          }
        })
        .catch((err) => {
          console.warn("Python backend upload failed:", err);
        });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to process file.';
      setError(msg);
      console.error(err);
    } finally {
      setIsLoading(false);
      setProcessingStage({ stage: 'idle', progress: 0 });
    }
  }, []);

  const filteredData = useMemo(() => {
    if (!graphData || !computedMetrics) return null;

    let filteredVertices = graphData.vertices.filter((v) => {
      if (filters.selectedCluster >= 0 && v.cluster !== filters.selectedCluster) return false;
      if (filters.keyword && !v.label.toLowerCase().includes(filters.keyword.toLowerCase()) && !v.tweetText.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
      if (!filters.sentiment.includes(v.sentiment)) return false;
      if (filters.platform !== 'All Platforms' && v.platform.toLowerCase() !== filters.platform.toLowerCase()) return false;
      if (filters.topic !== 'All Topics' && v.topic !== filters.topic) return false;
      if (v.followers < filters.minFollowers) return false;
      if (v.degree < filters.minDegree) return false;
      if (filters.dateRange[0] || filters.dateRange[1]) {
        if (!v.date) return false;
        const d = new Date(v.date);
        if (filters.dateRange[0] && d < new Date(filters.dateRange[0])) return false;
        if (filters.dateRange[1] && d > new Date(filters.dateRange[1])) return false;
      }
      return true;
    });

    const nodeIds = new Set(filteredVertices.map(v => v.id));
    const filteredEdges = graphData.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    filteredVertices = [...filteredVertices].sort((a, b) => {
      switch (filters.sortBy) {
        case 'Degree': return b.degree - a.degree;
        case 'Betweenness': return b.betweenness - a.betweenness;
        case 'PageRank': return b.pagerank - a.pagerank;
        case 'Followers': return b.followers - a.followers;
        case 'Clustering': return b.clusteringCoefficient - a.clusteringCoefficient;
        case 'Date': return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        default: return b.degree - a.degree;
      }
    });

    return { vertices: filteredVertices, edges: filteredEdges };
  }, [graphData, computedMetrics, filters]);

  const updateFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({
      keyword: '', sentiment: ['Pos', 'Neu', 'Neg'], platform: 'All Platforms',
      topic: 'All Topics', minFollowers: 0, minDegree: 0,
      sortBy: 'Degree', dateRange: ['', ''], selectedCluster: -1,
    });
  }, []);

  const goToLandingPage = useCallback(() => {
    setGraphData(null);
    setComputedMetrics(null);
    setAIInsights(null);
    setDriftData(null);
    setChatMessages([]);
    setAiAnalysisResult(null);
    clearSession();
    setPythonDatasetId(null);
    setError(null);
    setIsLoading(false);
    resetFilters();
  }, [resetFilters]);

  const dismissLoading = useCallback(() => {
    setProcessingStage({ stage: 'idle', progress: 0 });
  }, []);

  return {
    graphData,
    computedMetrics,
    aiInsights,
    driftData,
    setDriftData,
    chatMessages,
    setChatMessages,
    aiAnalysisResult,
    setAiAnalysisResult,
    pythonDatasetId,
    filteredData,
    isLoading,
    error,
    filters,
    processingStage,
    processFile,
    updateFilters,
    resetFilters,
    goToLandingPage,
    dismissLoading,
  };
};

const SocialDataContext = createContext<ReturnType<typeof useSocialDataState> | null>(null);

export const SocialDataProvider = ({ children }: { children: ReactNode }) => {
  const value = useSocialDataState();
  return createElement(SocialDataContext.Provider, { value }, children);
};

export const useSocialData = () => {
  const context = useContext(SocialDataContext);
  if (!context) {
    throw new Error('useSocialData must be used within a SocialDataProvider');
  }
  return context;
};

// === ASYNC WRAPPERS WITH YIELD ===

async function computeMetricsAsync(data: GraphData, onProgress: (pct: number) => void): Promise<ComputedMetrics> {
  // Break into chunks to keep UI responsive
  onProgress(0.05);
  await yieldToBrowser();

  if (data.hasPrecomputedMetrics) {
    // NodeXL precomputed vertex-level centrality values are already in the
    // vertex objects. We still need to compute graph-level topology stats
    // (components, reciprocity, density) because NodeXL doesn't export them.
    const topo = computeGraphTopology(data.vertices, data.edges);

    const sortedByDegree = [...data.vertices].sort((a, b) => b.degree - a.degree);
    const sortedByBetweenness = [...data.vertices].sort((a, b) => b.betweenness - a.betweenness);

    const computed: ComputedMetrics = {
      ...data.metrics,
      topInfluencers: sortedByDegree.slice(0, 10),
      topBetweenness: sortedByBetweenness.slice(0, 10),
      diameter: data.metrics.diameter || 0,
      avgClusteringCoefficient: data.metrics.avgClusteringCoefficient || 0,
      // Override the hardcoded parser values with real computed values
      connectedComponents: topo.connectedComponents,
      reciprocity: topo.reciprocity,
      density: topo.density,
      totalVertices: topo.n,
      totalEdges: topo.size,
    };
    onProgress(1.0);
    return computed;
  }

  // Do the actual work in chunks
  const result = await new Promise<ComputedMetrics>((resolve) => {
    setTimeout(() => {
      const r = computeSNAMetrics(data.vertices, data.edges);
      resolve(r);
    }, 20);
  });

  onProgress(0.9);
  await yieldToBrowser();
  onProgress(1.0);
  return result;
}

async function detectCommunitiesAsync(data: GraphData): Promise<void> {
  if (data.hasPrecomputedMetrics) {
    // Already parsed and assigned from Group Vertices in the parser
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      detectCommunities(data.vertices, data.edges);
      resolve();
    }, 20);
  });
}

async function analyzeAIAsync(data: GraphData): Promise<AIInsights> {
  return new Promise<AIInsights>((resolve) => {
    setTimeout(() => {
      const r = analyzeAI(data.vertices, data.edges);
      resolve(r);
    }, 20);
  });
}
