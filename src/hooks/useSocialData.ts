import { useState, useCallback, useMemo, createContext, useContext, ReactNode, createElement, useEffect, useRef } from 'react';
import { GraphData } from '../engine/csvParserEnhanced';
import { ComputedMetrics } from '../engine/graphMetrics';
import { AIInsights } from '../engine/aiInsights';
import { uploadFile, getSentiment, getDisinformation, getAnalysisData, SentimentData } from '../services/pythonApi';
import { loadSession, saveSession, clearSession } from '../services/db';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

function internGraphData(data: GraphData): GraphData {
  if (!data) return data;
  const stringPool = new Map<string, string>();
  const intern = (str: string | undefined | null): string => {
    if (!str) return '';
    let cached = stringPool.get(str);
    if (!cached) {
      stringPool.set(str, str);
      cached = str;
    }
    return cached;
  };

  data.vertices.forEach((v) => {
    v.id = intern(v.id);
    v.label = intern(v.label);
    v.sentiment = intern(v.sentiment) as 'Pos' | 'Neu' | 'Neg';
    v.platform = intern(v.platform);
    v.topic = intern(v.topic);
    v.clusterLabel = intern(v.clusterLabel);
    v.date = intern(v.date);
    if (v.hashtags) {
      v.hashtags = v.hashtags.map(intern);
    }
  });

  data.edges.forEach((e) => {
    e.source = intern(e.source);
    e.target = intern(e.target);
    e.date = intern(e.date);
    e.relation = intern(e.relation);
  });

  return data;
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

const useSocialDataState = () => {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [computedMetrics, setComputedMetrics] = useState<ComputedMetrics | null>(null);
  const [aiInsights, setAIInsights] = useState<AIInsights | null>(null);
  const [driftData, setDriftData] = useState<import('../services/pythonApi').DriftData | null>(null);
  const [commercialData, setCommercialData] = useState<import('../services/pythonApi').CommercialData | null>(null);
  const [pythonDatasetId, setPythonDatasetId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<ProcessingProgress>({ stage: 'idle', progress: 0 });
  const [isRestoring, setIsRestoring] = useState(true);

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

  const applySentimentData = useCallback((sentiment: SentimentData) => {
    const sentimentMap = new Map<string, 'Pos' | 'Neu' | 'Neg'>();
    sentiment.labels.forEach((label) => {
      sentimentMap.set(label.node, label.sentiment as 'Pos' | 'Neu' | 'Neg');
    });
    setGraphData((previous) => {
      if (!previous) return null;
      return {
        ...previous,
        vertices: previous.vertices.map((vertex) => ({
          ...vertex,
          sentiment: sentimentMap.get(vertex.id) ?? vertex.sentiment,
        })),
      };
    });
    setComputedMetrics((previous) => previous ? {
      ...previous,
      sentimentDistribution: {
        Pos: sentiment.clusters.Pos,
        Neu: sentiment.clusters.Neu,
        Neg: sentiment.clusters.Neg,
      },
    } : null);
  }, []);

  // ─── IndexedDB persistence ─────────────────────────────────────────
  // Restore saved session on first mount (only if no file is being processed)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    loadSession().then((saved) => {
      if (!saved || !saved.graphData) {
        setIsRestoring(false);
        return;
      }
      const interned = internGraphData(saved.graphData as GraphData);
      setGraphData(interned);
      if (saved.computedMetrics) setComputedMetrics(saved.computedMetrics as ComputedMetrics);
      if (saved.aiInsights) setAIInsights(saved.aiInsights as AIInsights);
      if (saved.driftData) setDriftData(saved.driftData as import('../services/pythonApi').DriftData);
      if (saved.commercialData) setCommercialData(saved.commercialData as import('../services/pythonApi').CommercialData);
      if (saved.chatMessages) setChatMessages(saved.chatMessages as ChatMessage[]);
      if (saved.aiAnalysisResult !== undefined) setAiAnalysisResult(saved.aiAnalysisResult);
      if (saved.pythonDatasetId) setPythonDatasetId(saved.pythonDatasetId);
      setIsRestoring(false);
    }).catch(() => {
      setIsRestoring(false);
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
      } catch {
        // Python backend may be unavailable on first restore — that's fine
      }
    }, 500);
    return () => clearTimeout(t);
  }, [pythonDatasetId]);

  // Debounced save — persists latest state to IndexedDB 1s after last change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scheduleSave = useCallback(() => {
    if (isRestoring) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSession({
        graphData,
        computedMetrics,
        aiInsights,
        driftData,
        commercialData,
        chatMessages,
        aiAnalysisResult,
        pythonDatasetId,
      });
    }, 1000);
  }, [isRestoring, graphData, computedMetrics, aiInsights, driftData, commercialData, chatMessages, aiAnalysisResult, pythonDatasetId]);

  // Auto-save when state changes
  useEffect(() => { scheduleSave(); }, [scheduleSave]);

  const processFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setDriftData(null);
    setCommercialData(null);
    setChatMessages([]);
    setAiAnalysisResult(null);
    clearSession();
    setProcessingStage({ stage: 'parsing', progress: 10 });

    try {
      // 1. Upload file to Python backend and let it run full analysis (FeatureEngineer, Sentiment, Disinfo, Censorship, Hashtags)
      const summary = await uploadFile(file);
      setProcessingStage({ stage: 'metrics', progress: 50 });

      if (!summary || !summary.dataset_id) {
        throw new Error("Failed to upload and analyze file on backend.");
      }

      setPythonDatasetId(summary.dataset_id);

      // 2. Fetch the computed metrics, full graph, and AI insights from backend in a single request!
      setProcessingStage({ stage: 'ai', progress: 80 });
      const data = await getAnalysisData(summary.dataset_id);

      const parsed: GraphData = internGraphData({
        vertices: data.vertices,
        edges: data.edges,
        metrics: data.metrics,
        hasPrecomputedMetrics: true
      });

      setGraphData(parsed);
      setComputedMetrics(data.metrics);
      setAIInsights(data.ai_insights);

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
    setCommercialData(null);
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
    commercialData,
    setCommercialData,
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
    applySentimentData,
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

// Unused async calculations removed; all processing delegated to Python backend.
