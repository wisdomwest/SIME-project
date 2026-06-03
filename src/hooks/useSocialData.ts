import { useState, useCallback, useMemo } from 'react';
import { GraphData, parseNodeXLFile } from '../engine/csvParserEnhanced';
import { ComputedMetrics, computeSNAMetrics } from '../engine/graphMetrics';
import { detectCommunities } from '../engine/communityDetection';
import { AIInsights, analyzeAI } from '../engine/aiInsights';

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

export const useSocialData = () => {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [computedMetrics, setComputedMetrics] = useState<ComputedMetrics | null>(null);
  const [aiInsights, setAIInsights] = useState<AIInsights | null>(null);
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

  const processFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to process file.';
      setError(msg);
      console.error(err);
    } finally {
      setIsLoading(false);
      setProcessingStage({ stage: 'idle', progress: 0 });
    }
  }, []);

  const loadDemo = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/test_node_xl.csv');
      const text = await res.text();
      const file = new File([text], 'demo.csv', { type: 'text/csv' });
      await processFile(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load demo data.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [processFile]);

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
    setError(null);
    setIsLoading(false);
    resetFilters();
  }, [resetFilters]);

  return {
    graphData,
    computedMetrics,
    aiInsights,
    filteredData,
    isLoading,
    error,
    filters,
    processingStage,
    processFile,
    loadDemo,
    updateFilters,
    resetFilters,
    goToLandingPage,
  };
};

// === ASYNC WRAPPERS WITH YIELD ===

async function computeMetricsAsync(data: GraphData, onProgress: (pct: number) => void): Promise<ComputedMetrics> {
  // Break into chunks to keep UI responsive
  onProgress(0.05);
  await yieldToBrowser();

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
