/**
 * pythonApi.ts — Client for the SIMElab Python analysis backend.
 * All calls go through the Vite proxy: /api/simelab/* → localhost:8000
 */

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
  }>;
}

export interface CensorshipData {
  dataset_id: string;
  fiedler_value: number;
  cvi: number | null;
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

// ─── API Functions ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function getHealth(): Promise<{ status: string; loaded_datasets: string[] }> {
  return apiFetch('/health');
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

export async function exportResults(datasetId = 'default', format = 'csv'): Promise<ExportResult> {
  return apiFetch(`/export?dataset_id=${encodeURIComponent(datasetId)}&format=${format}`, { method: 'POST' });
}
