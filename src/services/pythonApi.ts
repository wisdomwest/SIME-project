/**
 * pythonApi.ts — Client for the SIMElab Python analysis backend.
 * All calls go through the Vite proxy: /api/simelab/* → localhost:8000
 */

import type { GraphData } from '../engine/csvParserEnhanced';
import type { ComputedMetrics } from '../engine/graphMetrics';
import type { AIInsights } from '../engine/aiInsights';

const BASE = '/api/simelab';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnalysisSummary {
  dataset_id: string;
  nodes: number;
  edges: number;
  density: number;
  components: number;
  reciprocity: number | null;
  edge_types: Record<string, number>;
  top_influencers: InfluencerRow[];
  cache_hit: boolean;
}

export interface InfluencerRow {
  username: string;
  display_name: string;
  influence_score: number;
  followers: number;
}

export interface FeatureData {
  dataset_id: string;
  node_count: number;
  feature_names: string[];
  features: Array<{ node: string } & Record<string, number>>;
}

export interface SentimentData {
  dataset_id: string;
  silhouette: number | null;
  silhouette_sample_size: number;
  polarization_index: number;
  centroid_distance: number;
  clusters: { Neg: number; Neu: number; Pos: number };
  labels: Array<{ node: string; sentiment: string }>;
}

export interface DisinfoData {
  dataset_id: string;
  score_stats: { mean: number; std: number; min: number; max: number };
  risk_distribution: { clean: number; suspicious: number; likely_disinfo: number };
  scores: Array<{
    node: string;
    disinfo_score: number;
    risk_level: string;
    retweet_amplification?: number;
    temporal_regularity?: number;
    network_position_anomaly?: number;
    echo_chamber_index?: number;
    follower_sparse_connectivity?: number;
    verified?: boolean;
  }>;
}

export interface CensorshipData {
  dataset_id: string;
  fiedler_value: number;
  cvi: number | null;
  component_count: number;
  largest_component_nodes: number;
  largest_component_share: number;
  largest_component_fiedler: number | null;
  largest_component_normalized_fiedler: number | null;
  largest_component_max_betweenness: number | null;
  component_cvi: number | null;
  structural_holes: Array<{
    node: string;
    display_name: string;
    si_score: number;
    betweenness: number;
    degree: number;
    components_after_removal: number;
    component_increase: number;
    is_fragmenting: boolean;
  }>;
}

export interface HashtagData {
  dataset_id: string;
  hashtag_count: number;
  artificial_ratio: number;
  lifecycle: Record<string, string>;
  authenticity: Array<{
    hashtag: string;
    score: number;
    label: string;
    lifecycle_phase: string;
  }>;
}

export interface ExportResult {
  dataset_id: string;
  files: Record<string, string>;
}

export interface DisappearedNode {
  node: string;
  display_name: string;
  si_score: number;
  betweenness: number;
  degree: number;
}

export interface ComparisonData {
  dataset_id_1: string;
  dataset_id_2: string;
  disappeared_count: number;
  disappeared_critical_nodes: DisappearedNode[];
}

export interface DriftData {
  drift_score: number;
  is_coopted: boolean;
  early_topics: string[];
  late_topics: string[];
  analysis_text: string;
  swahili_sheng_count: number;
  sample_size: number;
  total_tweets: number;
}

/** A single term match within a keyword resolution group */
export interface CommercialTermHit {
  term: string;
  hits: number;
}

/**
 * Enriched per-keyword result from the two-phase intelligent search.
 * Includes offline + LLM entity resolution so the user can see:
 *   "You searched 'Liberty Shoes' → system resolved to liberty_stores (shoe vendor)"
 */
export interface CommercialKeywordResolution {
  original_query: string;
  /** The specific account/brand/entity the system thinks the user meant */
  resolved_entity?: string | null;
  /** 'account' | 'brand' | 'hashtag' | 'general_topic' */
  resolved_entity_type?: string | null;
  /** One-sentence description of what this entity does, from context */
  intent_summary?: string | null;
  /** Confidence in the resolution (0.0–1.0) */
  confidence?: number | null;
  /** Explanation of how the resolution was reached */
  reasoning?: string | null;
  /** Total rows matched by any term in this keyword group */
  total_hits: number;
  /** Individual term breakdown with hit counts */
  terms: CommercialTermHit[];
  /** Sample of matching tweets/posts for this category */
  sample_hits?: Array<{
    text: string;
    source: string;
    target: string;
    date: string;
  }>;
}

export interface CommercialData {
  total_tweets: number;
  commercial_tweets: number;
  percentage_commercial: number;
  category_counts: Record<string, number>;
  trend: Array<{ date: string; total: number; commercial: number }>;
  ai_analysis: {
    commercial_cooptation_level: number;
    main_tactics: string[];
    bot_vs_genuine: string;
    analysis_text: string;
  } | null;
  expanded_keywords: string[];
  keyword_mappings?: Record<string, CommercialKeywordResolution>;
  debug_info?: {
    source_column: string | null;
    target_column: string | null;
    date_column: string | null;
    text_column: string | null;
    total_rows_loaded: number;
    active_usernames_count: number;
  };
}

// ─── API Functions ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => '');
    const detail = body && typeof body === 'object' && 'detail' in body
      ? String(body.detail)
      : String(body || res.statusText);
    throw new Error(detail);
  }
  return res.json();
}

export async function getHealth(signal?: AbortSignal): Promise<{ status: string; loaded_datasets: string[] }> {
  return apiFetch('/health', { signal });
}

export async function uploadFile(file: File): Promise<AnalysisSummary> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch('/upload', { method: 'POST', body: form });
}

export async function getFeatures(datasetId = 'default'): Promise<FeatureData> {
  return apiFetch(`/features?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getSentiment(datasetId = 'default'): Promise<SentimentData> {
  return apiFetch(`/sentiment?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getDisinformation(datasetId = 'default'): Promise<DisinfoData> {
  return apiFetch(`/disinformation?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getCensorship(datasetId = 'default'): Promise<CensorshipData> {
  return apiFetch(`/censorship?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getHashtags(datasetId = 'default'): Promise<HashtagData> {
  return apiFetch(`/hashtags?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getSemanticDrift(datasetId: string): Promise<DriftData> {
  return apiFetch(`/drift?dataset_id=${encodeURIComponent(datasetId)}`);
}

export async function getCommercial(datasetId: string, baseKeywords: string, useAi: boolean): Promise<CommercialData> {
  return apiFetch<CommercialData>('/commercial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, base_keywords: baseKeywords, use_ai: useAi }),
  });
}

export async function compareDatasets(datasetId1: string, datasetId2: string): Promise<ComparisonData> {
  return apiFetch('/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id_1: datasetId1, dataset_id_2: datasetId2 }),
  });
}

export async function exportResults(datasetId = 'default', format = 'csv'): Promise<ExportResult> {
  return apiFetch(`/export?dataset_id=${encodeURIComponent(datasetId)}&format=${format}`, { method: 'POST' });
}

export interface BackendLLMConfig {
  provider: 'nvidia-nim' | 'deepseek' | 'tokenrouter';
  configured: boolean;
  model: string;
}

export async function getBackendLLMConfig(): Promise<BackendLLMConfig> {
  return apiFetch('/llm-config');
}

export interface BackendAnalysisData {
  vertices: GraphData['vertices'];
  edges: GraphData['edges'];
  metrics: ComputedMetrics;
  ai_insights: AIInsights;
}

export async function getAnalysisData(datasetId = 'default'): Promise<BackendAnalysisData> {
  return apiFetch(`/analysis-data?dataset_id=${encodeURIComponent(datasetId)}`);
}
