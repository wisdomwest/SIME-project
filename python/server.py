"""
server.py — FastAPI backend for SIMElab Data Explorer.

Serves the Python analysis engine behind the Vite proxy.
All endpoints live under /api/simelab/* and are proxied by Vite dev server.

Usage:
    cd SIME-project && python python/server.py
    # Starts on http://localhost:8000
    # Vite proxies /api/simelab/* → http://localhost:8000/api/simelab/*
"""

import asyncio
import hashlib
import json
import logging
import re
import secrets
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

# Ensure simelab package is importable
sys.path.insert(0, str(Path(__file__).parent))

def _env_paths():
    """Return dotenv candidates from most app-specific to least specific."""
    candidates = (
        Path.cwd() / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent / ".env",
        Path(__file__).parent.parent.parent / ".env",
    )
    return tuple(dict.fromkeys(path.resolve() for path in candidates))


def load_env():
    # Load the first app-local dotenv file. The process environment wins so
    # deployment-provided secrets cannot be overwritten by a local .env file.
    for p in _env_paths():
        if p.exists():
            print(f"Loading environment from {p}")
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'").strip('"')
                        os.environ.setdefault(k, v)
            break

load_env()


def read_env_key(key: str, default: str = "") -> str:
    # Environment variables are authoritative; fall back to the same
    # app-local dotenv discovery used during startup.
    if os.environ.get(key):
        return os.environ[key]
    for p in _env_paths():
        if not p.exists():
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() == key:
                            return v.strip().strip("'").strip('"')
        except Exception:
            pass
        # Do not fall through to a different application's .env file.
        break
    return os.environ.get(key, default)

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import uvicorn

from simelab.loader import load_nodexl
from simelab.features import FeatureEngineer, BETWEENNESS, INFLUENCE
from simelab.sentiment import SentimentAnalyzer
from simelab.disinformation import DisinformationAnalyzer
from simelab.censorship import CensorshipAnalyzer
from simelab.export import ExportManager
from simelab.drift import SemanticDriftAnalyzer
from simelab.commercial import CommercialAnalyzer

from simelab.redis_cache import (
    cache_status, get_dataset_meta, get_stored_filepath, list_datasets,
    save_full_analysis, update_sentiment_analysis,
)

# ─── App Setup ───────────────────────────────────────────────────────────────

logger = logging.getLogger("simelab")
WORKSPACE_ROOT = Path(__file__).parent.parent.parent.resolve()
PUBLIC_IMAGE_ROOTS = [WORKSPACE_ROOT / "RejectFinanceBill2024"]
MAX_UPLOAD_BYTES = int(os.environ.get("SIMELAB_MAX_UPLOAD_MB", "200")) * 1024 * 1024

app = FastAPI(
    title="SIMElab Data Explorer API",
    description="Python analysis engine for social media network data",
    version="1.0.0",
)

cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        "SIMELAB_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── State ───────────────────────────────────────────────────────────────────
# In-memory analysis cache: dataset_id → {G, meta, fe, sa, da, ca, ha}
analyses: dict = {}

# Default dataset (RejectFinanceBill2024)
DEFAULT_DATASET = str(WORKSPACE_ROOT / "RejectFinanceBill2024.xlsx")

# Persistent uploads directory — files must survive beyond the request so
# long-running endpoints like /drift can re-open them.
UPLOADS_DIR = WORKSPACE_ROOT / "files" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Opaque export token → exact files created by that export operation.
exports_registry: dict[str, dict] = {}


# ─── Pydantic Models ─────────────────────────────────────────────────────────

class AnalysisSummary(BaseModel):
    dataset_id: str
    nodes: int
    edges: int
    density: float
    components: int
    reciprocity: Optional[float] = None
    edge_types: dict = Field(default_factory=dict)
    top_influencers: list = Field(default_factory=list)
    cache_hit: bool = False


class FeatureResponse(BaseModel):
    dataset_id: str
    node_count: int
    feature_names: list
    features: list  # list of {node, ...features}


class SentimentResponse(BaseModel):
    dataset_id: str
    silhouette: Optional[float]
    silhouette_sample_size: int
    polarization_index: float
    centroid_distance: float
    clusters: dict  # {"Neg": count, "Neu": count, "Pos": count}
    labels: list  # list of {node, sentiment}


class DisinfoResponse(BaseModel):
    dataset_id: str
    score_stats: dict  # {mean, std, min, max}
    risk_distribution: dict  # {clean, suspicious, likely_disinfo}
    scores: list  # list of {node, disinfo_score, risk_level, ...signals}


class CensorshipResponse(BaseModel):
    dataset_id: str
    fiedler_value: float
    cvi: Optional[float]
    component_count: int
    largest_component_nodes: int
    largest_component_share: float
    largest_component_fiedler: Optional[float]
    largest_component_normalized_fiedler: Optional[float]
    largest_component_max_betweenness: Optional[float]
    component_cvi: Optional[float]
    structural_holes: list


class HashtagResponse(BaseModel):
    dataset_id: str
    hashtag_count: int
    artificial_ratio: float
    lifecycle: dict
    authenticity: list


class CompareRequest(BaseModel):
    dataset_id_1: str
    dataset_id_2: str


class LLMChatRequest(BaseModel):
    user_question: str = Field(min_length=1, max_length=4000)
    context: str = Field(default="", max_length=30000)


class CommercialRequest(BaseModel):
    dataset_id: str = "default"
    base_keywords: str = Field(default="", max_length=4000)
    use_ai: bool = True


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _normalise_dataset_id(filename: str) -> str:
    """Create a filesystem-safe, stable dataset identifier from an upload name."""
    identifier = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-")
    if not identifier:
        raise HTTPException(400, "The uploaded filename does not contain a valid dataset name.")
    return identifier[:120]


def _hash_file(filepath: Path) -> str:
    digest = hashlib.sha256()
    with filepath.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _censorship_metrics(ca: CensorshipAnalyzer) -> dict:
    """Return versioned whole-network and giant-component connectivity values."""
    ca.censorship_vulnerability_index()
    return {
        "fiedler_value": ca._compute_fiedler(),
        "cvi": ca.cvi,
        "network_components": ca.component_count,
        "largest_component_nodes": ca.largest_component_nodes,
        "largest_component_share": ca.largest_component_share,
        "largest_component_fiedler": ca.largest_component_fiedler,
        "largest_component_normalized_fiedler": ca.largest_component_normalized_fiedler,
        "largest_component_max_betweenness": ca.largest_component_max_betweenness,
        "component_cvi": ca.component_cvi,
        "censorship_method_version": CensorshipAnalyzer.METHOD_VERSION,
    }


def _analysis_metric_context(state: dict) -> str:
    """Canonical Redis-restored metrics for LLM prompts."""
    ca = state["ca"]
    sa = state["sa"]
    da = state["da"]
    risk_counts = {
        label: sum(1 for value in da.risk_labels.values() if value == label)
        for label in ("clean", "suspicious", "likely_disinfo")
    }
    largest_fiedler = (
        f"{ca.largest_component_fiedler:.8f}"
        if ca.largest_component_fiedler is not None else "N/A"
    )
    component_cvi = (
        f"{ca.component_cvi:.8f}" if ca.component_cvi is not None else "N/A"
    )
    return (
        "Persisted SIMElab network metrics (treat as ground truth):\n"
        f"- Accounts: {state['G'].number_of_nodes()}; connections: {state['G'].number_of_edges()}\n"
        f"- Sentiment clusters: Pos {sa.cluster_sizes.get('Pos', 0)}, "
        f"Neu {sa.cluster_sizes.get('Neu', 0)}, Neg {sa.cluster_sizes.get('Neg', 0)}; "
        f"polarization {sa.polarization_index():.6f}\n"
        f"- Whole network: {ca.component_count} components, Fiedler λ2 "
        f"{ca._compute_fiedler():.8f}, CVI "
        f"{ca.cvi if ca.cvi is not None else 'N/A (disconnected)'}\n"
        f"- Giant component: {ca.largest_component_nodes} accounts "
        f"({ca.largest_component_share:.2%}), Fiedler λ2 "
        f"{largest_fiedler}, component CVI {component_cvi}\n"
        f"- Disinformation risk: {risk_counts['likely_disinfo']} likely, "
        f"{risk_counts['suspicious']} suspicious, {risk_counts['clean']} clean"
    )


def _resolve_public_image(image_path: str) -> Path:
    """Resolve an image only when it stays inside an explicitly public directory."""
    if not image_path or Path(image_path).is_absolute():
        raise HTTPException(404, "Image not found")
    requested = (WORKSPACE_ROOT / image_path).resolve()
    allowed_suffixes = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    if requested.suffix.lower() not in allowed_suffixes:
        raise HTTPException(404, "Image not found")
    if not any(requested.is_relative_to(root.resolve()) for root in PUBLIC_IMAGE_ROOTS):
        raise HTTPException(404, "Image not found")
    if not requested.is_file():
        raise HTTPException(404, "Image not found")
    return requested


def _llm_settings() -> tuple[str, str, str, str]:
    """Return provider, key, model and endpoint without exposing the key to clients."""
    providers = (
        ("tokenrouter", "TOKENROUTER_API_KEY", "MiniMax-M3", "https://api.tokenrouter.com/v1/chat/completions"),
        ("nvidia-nim", "NVIDIA_API_KEY", "meta/llama-3.1-70b-instruct", "https://integrate.api.nvidia.com/v1/chat/completions"),
        ("deepseek", "DEEPSEEK_API_KEY", "deepseek-chat", "https://api.deepseek.com/v1/chat/completions"),
    )
    for provider, env_name, model, endpoint in providers:
        key = read_env_key(env_name)
        if key:
            return provider, key, model, endpoint
    return "deepseek", "", "deepseek-chat", "https://api.deepseek.com/v1/chat/completions"


def _call_llm(user_question: str, context: str) -> str:
    provider, key, model, endpoint = _llm_settings()
    if not key:
        raise HTTPException(503, "Server-side LLM is not configured.")
    system_prompt = (
        "You are a social network analysis expert at SIMElab Africa, USIU-Africa. "
        "Be concise, data-driven, and professional. Treat supplied network metrics as ground truth "
        "and cite specific numbers when available.\n\nDataset context:\n" + context
    )
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_question},
        ],
        "temperature": 0.3,
        "max_tokens": 1500,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.warning("%s LLM request failed with HTTP %s", provider, exc.code)
        raise HTTPException(502, "The configured LLM provider rejected the request.") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("%s LLM request failed: %s", provider, type(exc).__name__)
        raise HTTPException(502, "The configured LLM provider is unavailable.") from exc
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(502, "The configured LLM provider returned an empty response.")
    return content

def _run_full_analysis(filepath: str, dataset_id: str, source_hash: Optional[str] = None) -> dict:
    """Run the full analysis pipeline on a file. Returns state dict."""
    timings = {}
    started = time.perf_counter()
    G, meta = load_nodexl(filepath)
    timings["load"] = time.perf_counter() - started
    meta["source_hash"] = source_hash or _hash_file(Path(filepath))

    started = time.perf_counter()
    fe = FeatureEngineer(G)
    fe.build_matrix()
    fe_dict = fe.to_dict()
    for node, features in fe_dict.items():
        attrs = G.nodes[node]
        attrs["degree"] = G.degree(node)
        attrs["in_degree"] = G.in_degree(node) if G.is_directed() else G.degree(node)
        attrs["out_degree"] = G.out_degree(node) if G.is_directed() else G.degree(node)
        attrs["betweenness"] = features["betweenness_centrality"]
        attrs["closeness"] = features["closeness_centrality"]
        attrs["eigenvector"] = features["eigenvector_centrality"]
        attrs["pagerank"] = features["pagerank"]
        attrs["clustering_coefficient"] = features["clustering_coefficient"]
    timings["features"] = time.perf_counter() - started

    started = time.perf_counter()
    sa = SentimentAnalyzer(fe)
    sa.fit()
    for node, label in sa.labels.items():
        G.nodes[node]["sentiment"] = label
    for node, cluster_id in zip(sa.nodes, sa.cluster_ids):
        G.nodes[node]["cluster"] = int(cluster_id)
    timings["sentiment"] = time.perf_counter() - started

    meta.setdefault("overall_metrics", {})
    meta["overall_metrics"].update({
        "sentiment_silhouette": sa.silhouette,
        "sentiment_silhouette_sample_size": sa.silhouette_sample_size,
        "polarization_index": sa.polarization_index(),
        "sentiment_centroid_distance": sa.centroid_distance(),
        "sentiment_method_version": SentimentAnalyzer.METHOD_VERSION,
    })

    started = time.perf_counter()
    da = DisinformationAnalyzer(G, fe)
    da.score_all()
    timings["disinformation"] = time.perf_counter() - started

    started = time.perf_counter()
    # Betweenness is already the second feature dimension. Reuse it instead of
    # running the same sampled all-pairs computation a second time.
    fe_nodes = fe.get_nodes()
    betweenness = {
        node: float(fe._matrix[index, BETWEENNESS])
        for index, node in enumerate(fe_nodes)
    }
    ca = CensorshipAnalyzer(G, betweenness=betweenness)
    ca.find_structural_holes(k=20)
    ca.censorship_vulnerability_index()
    timings["censorship"] = time.perf_counter() - started

    # Hashtags (non-critical, may fail if no text)
    # The loader already parsed the Edges sheet. Reusing it avoids a second
    # complete XLSX scan on every upload.
    edges_df = meta.pop("_edges_df", None)

    started = time.perf_counter()
    from simelab.hashtag import HashtagAnalyzer
    ha = HashtagAnalyzer(G, edges_df)
    ha.detect_lifecycle()
    ha.score_hashtags()
    timings["hashtags"] = time.perf_counter() - started

    # Store both whole-network and giant-component metrics so Redis restoration
    # preserves the documented interpretation without spectral recomputation.
    meta.setdefault("overall_metrics", {})
    meta["overall_metrics"].update(_censorship_metrics(ca))
    meta["analysis_timings_ms"] = {
        stage: round(seconds * 1000, 1) for stage, seconds in timings.items()
    }

    state = {
        "G": G,
        "meta": meta,
        "fe": fe,
        "sa": sa,
        "da": da,
        "ca": ca,
        "ha": ha,
        "filepath": filepath,
        "_feature_dict": fe_dict,
    }
    analyses[dataset_id] = state

    # Redis is a restore cache only. Uploads always execute this full pipeline.
    _save_analysis_to_cache(dataset_id, state)

    return state


def _build_analysis_summary(dataset_id: str, state: dict, cache_hit: bool = False) -> AnalysisSummary:
    G = state["G"]
    meta = state["meta"]
    fe = state["fe"]
    gs = meta.get("graph_stats", {})
    top_inf = fe.get_top(INFLUENCE, k=10)
    top_list = [
        {
            "username": node,
            "display_name": G.nodes[node].get("display_name", ""),
            "influence_score": round(score, 6),
            "followers": G.nodes[node].get("followers", 0),
        }
        for node, score in top_inf
    ]
    return AnalysisSummary(
        dataset_id=dataset_id,
        nodes=G.number_of_nodes(),
        edges=G.number_of_edges(),
        density=round(gs.get("density", 0), 6),
        components=gs.get("connected_components", 0),
        reciprocity=round(gs.get("reciprocity", 0), 6) if gs.get("reciprocity") else None,
        edge_types=gs.get("edge_types", {}),
        top_influencers=top_list,
        cache_hit=cache_hit,
    )


def _load_analysis_from_cache(dataset_id: str) -> Optional[dict]:
    """Reconstruct the analysis state dictionary from a Redis result payload."""
    try:
        from simelab.redis_cache import (
            get_dataset_meta, load_vertices, load_edges,
            load_disinfo_scores, load_hashtags, load_structural_holes
        )
        import json
        import networkx as nx
        import numpy as np

        meta_row = get_dataset_meta(dataset_id)
        if not meta_row:
            return None

        # Redis keeps one compressed JSON blob; these accessors share one
        # decompressed in-process payload during reconstruction.
        vertices_rows = load_vertices(dataset_id)
        edges_rows = load_edges(dataset_id)
        disinfo_rows = load_disinfo_scores(dataset_id)
        hashtags_rows = load_hashtags(dataset_id)
        holes_rows = load_structural_holes(dataset_id)

        # 1. Reconstruct meta
        meta = {
            "filename": meta_row["name"],
            "filepath": meta_row["filepath"],
            "graph_stats": {
                "node_count": meta_row["nodes_count"],
                "edge_count": meta_row["edges_count"],
                "density": meta_row["density"],
                "reciprocity": meta_row["reciprocity"],
                "connected_components": meta_row["components"],
            }
        }
        if meta_row["edge_types_json"]:
            try:
                meta["graph_stats"]["edge_types"] = json.loads(meta_row["edge_types_json"])
            except Exception:
                meta["graph_stats"]["edge_types"] = {}
        if meta_row["overall_metrics_json"]:
            try:
                meta["overall_metrics"] = json.loads(meta_row["overall_metrics_json"])
            except Exception:
                pass

        # 2. Reconstruct G
        G = nx.DiGraph()
        for v in vertices_rows:
            node_id = v["id"]
            attrs = {
                "display_name": v["label"],
                "degree": v["degree"],
                "in_degree": v["in_degree"],
                "out_degree": v["out_degree"],
                "betweenness": v["betweenness"],
                "closeness": v["closeness"],
                "eigenvector": v["eigenvector"],
                "pagerank": v["pagerank"],
                "clustering_coefficient": v["clustering_coefficient"],
                "followers": v["followers"],
                "layout_x": v["layout_x"],
                "layout_y": v["layout_y"],
                "sentiment": v["sentiment"],
                "cluster": v["cluster"],
                "is_bot": bool(v["is_bot"]),
                "bot_score": v["bot_score"],
            }
            if v["tweet_text"]:
                attrs["tweet_text"] = v["tweet_text"]
            if v["platform"]:
                attrs["platform"] = v["platform"]
            if v["topic"]:
                attrs["topic"] = v["topic"]
            if v["hashtags_json"]:
                try:
                    attrs["hashtags"] = json.loads(v["hashtags_json"]) or []
                except Exception:
                    attrs["hashtags"] = []
            G.add_node(node_id, **attrs)

        for e in edges_rows:
            G.add_edge(
                e["source"],
                e["target"],
                weight=e["weight"],
                date=e["date"],
                edge_type=e["relation"],
                Relationship=e["relation"],
            )

        # Older persisted analyses may contain NULL centrality values. NetworkX
        # still knows the structural degrees after edges are restored, so fill
        # those values before any sorting or arithmetic happens.
        for node, attrs in G.nodes(data=True):
            in_degree = attrs.get("in_degree")
            out_degree = attrs.get("out_degree")
            attrs["in_degree"] = int(in_degree) if in_degree is not None else G.in_degree(node)
            attrs["out_degree"] = int(out_degree) if out_degree is not None else G.out_degree(node)
            degree = attrs.get("degree")
            attrs["degree"] = int(degree) if degree is not None else attrs["in_degree"] + attrs["out_degree"]
            for metric in (
                "betweenness", "closeness", "eigenvector", "pagerank",
                "clustering_coefficient", "followers", "layout_x", "layout_y", "bot_score",
            ):
                if attrs.get(metric) is None:
                    attrs[metric] = 0.0

        # 3. Reconstruct Mock classes
        from simelab.features import FEATURE_NAMES
        class MockFeatureEngineer:
            def __init__(self, G, vertices_rows):
                self.G = G
                self._nodes = sorted(list(G.nodes()))
                self._node_to_idx = {node: i for i, node in enumerate(self._nodes)}
                self.features_dict = {}
                self._matrix = np.zeros((len(self._nodes), 9))
                for v in vertices_rows:
                    node_id = v["id"]
                    if node_id not in self._node_to_idx:
                        continue
                    idx = self._node_to_idx[node_id]
                    feats = {}
                    if v["features_json"]:
                        try:
                            feats = json.loads(v["features_json"])
                        except Exception:
                            pass
                    for col_idx, name in enumerate(FEATURE_NAMES):
                        val = feats.get(name)
                        if val is not None:
                            self._matrix[idx, col_idx] = val
                        else:
                            if name == "degree_centrality":
                                self._matrix[idx, col_idx] = v["degree"] or 0.0
                            elif name == "betweenness_centrality":
                                self._matrix[idx, col_idx] = v["betweenness"] or 0.0
                            elif name == "closeness_centrality":
                                self._matrix[idx, col_idx] = v["closeness"] or 0.0
                            elif name == "eigenvector_centrality":
                                self._matrix[idx, col_idx] = v["eigenvector"] or 0.0
                            elif name == "pagerank":
                                self._matrix[idx, col_idx] = v["pagerank"] or 0.0
                            elif name == "clustering_coefficient":
                                self._matrix[idx, col_idx] = v["clustering_coefficient"] or 0.0
                    self.features_dict[node_id] = {
                        name: float(self._matrix[idx, col_idx])
                        for col_idx, name in enumerate(FEATURE_NAMES)
                    }

            def get_nodes(self):
                return self._nodes

            def build_matrix(self, force_recompute=False):
                return self._matrix

            def get_node(self, node):
                idx = self._node_to_idx.get(node)
                if idx is None:
                    return None
                return self._matrix[idx]

            def get_top(self, dimension: int, k: int = 10):
                col = self._matrix[:, dimension]
                top_indices = np.argsort(col)[::-1][:k]
                return [(self._nodes[i], float(col[i])) for i in top_indices]

            def to_dict(self):
                return self.features_dict

            def to_dataframe(self):
                import pandas as pd
                df = pd.DataFrame(self._matrix, index=self._nodes, columns=FEATURE_NAMES)
                df.index.name = "node"
                return df

        fe = MockFeatureEngineer(G, vertices_rows)

        class MockSentimentAnalyzer:
            def __init__(self, fe, vertices_rows, persisted_metrics):
                self.fe = fe
                self.nodes = fe.get_nodes()
                self.n = len(self.nodes)
                self.labels = {}
                for v in vertices_rows:
                    self.labels[v["id"]] = v["sentiment"] or "Neu"
                self.cluster_sizes = {
                    label: sum(1 for l in self.labels.values() if l == label)
                    for label in ["Pos", "Neu", "Neg"]
                }
                from sklearn.preprocessing import MinMaxScaler
                self.scaler = MinMaxScaler()
                self.X_norm = self.scaler.fit_transform(fe.build_matrix())
                label_to_id = {"Pos": 0, "Neu": 1, "Neg": 2}
                self.cluster_ids = np.array([label_to_id.get(self.labels[node], 1) for node in self.nodes])
                self.centroids = np.zeros((3, 9))
                for label, cid in label_to_id.items():
                    mask = self.cluster_ids == cid
                    if mask.any():
                        self.centroids[cid] = self.X_norm[mask].mean(axis=0)
                # Silhouette scoring is quadratic in the number of samples.
                # Restore the value saved by the original analysis rather than
                # silently recomputing it whenever the server restarts.
                self.silhouette = persisted_metrics.get("sentiment_silhouette")
                self.silhouette_sample_size = persisted_metrics.get(
                    "sentiment_silhouette_sample_size", 0
                )

            def polarization_index(self) -> float:
                pos = self.cluster_sizes.get("Pos", 0)
                neg = self.cluster_sizes.get("Neg", 0)
                return (2.0 * min(pos, neg)) / max(self.n, 1)

            def centroid_distance(self) -> float:
                pos_cid = 0
                neg_cid = 2
                raw_distance = np.linalg.norm(self.centroids[pos_cid] - self.centroids[neg_cid])
                return float(raw_distance / np.sqrt(self.centroids.shape[1]))

        persisted_metrics = meta.setdefault("overall_metrics", {})
        if persisted_metrics.get("sentiment_method_version") != SentimentAnalyzer.METHOD_VERSION:
            # Upgrade only the inexpensive 9-D clustering layer. The graph,
            # centralities, disinformation, censorship, and hashtag analyses
            # remain loaded from Redis.
            sa = SentimentAnalyzer(fe)
            sa.fit()
            for node, label in sa.labels.items():
                G.nodes[node]["sentiment"] = label
            persisted_metrics.update({
                "sentiment_silhouette": sa.silhouette,
                "sentiment_silhouette_sample_size": sa.silhouette_sample_size,
                "polarization_index": sa.polarization_index(),
                "sentiment_centroid_distance": sa.centroid_distance(),
                "sentiment_method_version": SentimentAnalyzer.METHOD_VERSION,
            })
            update_sentiment_analysis(dataset_id, sa.labels, persisted_metrics)
        else:
            sa = MockSentimentAnalyzer(fe, vertices_rows, persisted_metrics)

        # Keep the graph used by overview/analysis endpoints synchronized with
        # the authoritative sentiment analyzer restored from Redis.
        for node, label in sa.labels.items():
            G.nodes[node]["sentiment"] = label
        for node, cluster_id in zip(sa.nodes, sa.cluster_ids):
            G.nodes[node]["cluster"] = int(cluster_id)

        class MockDisinformationAnalyzer:
            def __init__(self, G, disinfo_rows):
                self.G = G
                self.nodes = list(G.nodes())
                self.scores = {}
                self.risk_labels = {}
                self.signals = {}
                for row in disinfo_rows:
                    node = row["node"]
                    self.scores[node] = row["disinfo_score"]
                    self.risk_labels[node] = row["risk_level"]
                    try:
                        self.signals[node] = json.loads(row["signals_json"]) if row["signals_json"] else {}
                    except Exception:
                        self.signals[node] = {}

        da = MockDisinformationAnalyzer(G, disinfo_rows)

        class MockCensorshipAnalyzer:
            def __init__(self, G, holes_rows, metrics):
                self.G = G
                self.fiedler_value = metrics.get("fiedler_value", 0.0)
                self.cvi = metrics.get("cvi")
                self.component_count = metrics.get("network_components", 1)
                self.largest_component_nodes = metrics.get("largest_component_nodes", len(G))
                self.largest_component_share = metrics.get("largest_component_share", 1.0)
                self.largest_component_fiedler = metrics.get("largest_component_fiedler")
                self.largest_component_normalized_fiedler = metrics.get(
                    "largest_component_normalized_fiedler"
                )
                self.largest_component_max_betweenness = metrics.get(
                    "largest_component_max_betweenness"
                )
                self.component_cvi = metrics.get("component_cvi")
                self.betweenness = {node: G.nodes[node].get("betweenness", 0.0) for node in G.nodes()}
                self.structural_holes = []
                for row in holes_rows:
                    node = row["node"]
                    si_score = row["si_score"]
                    details = {
                        "node": node,
                        "display_name": row["display_name"],
                        "si_score": si_score,
                        "betweenness": row["betweenness"],
                        "degree": row["degree"],
                        "components_after_removal": row["components_after_removal"],
                        "component_increase": row["component_increase"],
                        "is_fragmenting": bool(row["is_fragmenting"]),
                    }
                    self.structural_holes.append((node, si_score, details))

            def _compute_fiedler(self):
                return self.fiedler_value

            def censorship_vulnerability_index(self):
                return self.cvi

            def structural_impact(self, node):
                cb = self.betweenness.get(node, 0.0)
                if self.G.is_directed():
                    total_deg = self.G.in_degree(node) + self.G.out_degree(node)
                else:
                    total_deg = self.G.degree(node)
                return cb * np.log(total_deg + 1)

        censorship_upgraded = (
            persisted_metrics.get("censorship_method_version")
            != CensorshipAnalyzer.METHOD_VERSION
        )
        if censorship_upgraded:
            betweenness = {
                node: float(fe._matrix[index, BETWEENNESS])
                for index, node in enumerate(fe.get_nodes())
            }
            ca = CensorshipAnalyzer(G, betweenness=betweenness)
            ca.find_structural_holes(k=20)
            persisted_metrics.update(_censorship_metrics(ca))
        else:
            ca = MockCensorshipAnalyzer(G, holes_rows, persisted_metrics)

        class MockHashtagAnalyzer:
            def __init__(self, hashtags_rows):
                self.authenticity = {}
                self.lifecycle = {}
                self.gmm_labels = {}
                for row in hashtags_rows:
                    tag = row["hashtag"]
                    self.authenticity[tag] = {
                        "score": row["score"],
                        "label": row["label"],
                    }
                    self.lifecycle[tag] = row["lifecycle_phase"]
                    self.gmm_labels[tag] = row["label"]

            def artificial_ratio(self):
                total = len(self.authenticity)
                if total == 0:
                    return 0.0
                artificial = sum(1 for v in self.gmm_labels.values() if v == "Artificial")
                return artificial / total

        ha = MockHashtagAnalyzer(hashtags_rows)

        state = {
            "G": G,
            "meta": meta,
            "fe": fe,
            "sa": sa,
            "da": da,
            "ca": ca,
            "ha": ha,
            "filepath": meta_row["filepath"],
        }
        analyses[dataset_id] = state
        if censorship_upgraded:
            _save_analysis_to_cache(dataset_id, state)
        return state

    except Exception as ex:
        print(f"Error reconstructing analysis from Redis for '{dataset_id}': {ex}")
        return None


def _save_analysis_to_cache(dataset_id: str, state: dict):
    """Serialize and compress a completed analysis into Redis."""
    try:
        G = state["G"]
        meta = state["meta"]
        fe = state["fe"]
        sa = state["sa"]
        da = state["da"]
        ca = state["ca"]
        ha = state["ha"]

        # Pre-compute feature dict once
        fe_dict = state.pop("_feature_dict", None) or fe.to_dict()
        cluster_by_node = {
            node: int(cluster_id)
            for node, cluster_id in zip(sa.nodes, sa.cluster_ids)
        }

        # Build serializable vertex list
        vertices_serial = []
        for node in G.nodes():
            attrs = G.nodes[node]
            label = attrs.get("display_name", "")
            # Coerce to string — the Excel may contain datetime/time values
            # in the Name column (data quality edge case)
            if not isinstance(label, str):
                label = str(label) if label is not None else ""
            v = {"id": node, "label": label}
            for key in ("degree", "in_degree", "out_degree", "betweenness",
                        "closeness", "eigenvector", "pagerank", "clustering_coefficient",
                        "followers", "layout_x", "layout_y"):
                v[key] = attrs.get(key)
            for key in ("tweet_text", "platform", "topic", "hashtags", "bot_score"):
                v[key] = attrs.get(key)
            v["is_bot"] = bool(attrs.get("is_bot", False))
            # Sentiment label
            v["sentiment"] = sa.labels.get(node, "unknown")
            v["cluster"] = cluster_by_node.get(node)
            # Features from the feature engineer (no node_features attr — use to_dict)
            v["features"] = fe_dict.get(node, {})
            vertices_serial.append(v)

        # Build serializable edge list
        edges_serial = []
        for src, tgt, data in G.edges(data=True):
            edge_row = {
                "source": src,
                "target": tgt,
                "weight": float(data["weight"]) if data.get("weight") is not None else None,
                "date": None,
                "relation": data.get("edge_type", data.get("Relationship")),
            }
            # Find any date-ish value across all edge attributes
            for raw_key, raw_val in data.items():
                if raw_val is not None and hasattr(raw_val, "isoformat"):
                    edge_row["date"] = raw_val.isoformat()
                    break
            edges_serial.append(edge_row)

        # Build disinfo scores
        disinfo_serial = []
        for node in da.nodes:
            disinfo_serial.append({
                "node": node,
                "disinfo_score": da.scores.get(node, 0),
                "risk_level": da.risk_labels.get(node, "clean"),
                "signals": da.signals.get(node, {}),
            })

        # Build hashtag list
        hashtag_serial = []
        for tag, data in ha.authenticity.items():
            hashtag_serial.append({
                "hashtag": tag,
                "score": data["score"],
                "label": data["label"],
                "lifecycle_phase": ha.lifecycle.get(tag, "Unknown"),
            })

        # Build structural holes
        holes_serial = []
        for node, si, details in ca.structural_holes:
            holes_serial.append({
                "node": node,
                "display_name": G.nodes[node].get("display_name", ""),
                "si_score": si,
                "betweenness": details.get("betweenness", 0),
                "degree": details.get("degree", 0),
                "components_after_removal": details.get("components_after_removal", 1),
                "component_increase": details.get("component_increase", 0),
                "is_fragmenting": details.get("is_fragmenting", False),
            })

        serializable = {
            "graph_stats": meta.get("graph_stats", {}),
            "overall_metrics": meta.get("overall_metrics", {}),
            "vertices": vertices_serial,
            "edges": edges_serial,
            "disinfo_scores": disinfo_serial,
            "hashtags": hashtag_serial,
            "structural_holes": holes_serial,
        }

        if save_full_analysis(dataset_id, meta, serializable):
            print(f"  [redis] Cached analysis '{dataset_id}' ({len(vertices_serial)} vertices, {len(edges_serial)} edges)")
        else:
            print(f"  [redis] Cache unavailable; '{dataset_id}' remains available in memory")
    except Exception as e:
        print(f"  [redis] Warning: could not cache '{dataset_id}': {e}")


def _get_analysis(dataset_id: str) -> dict:
    """Get cached analysis or raise 404."""
    if dataset_id not in analyses:
        # A reload normally hits memory; a Python restart restores from Redis.
        state = _load_analysis_from_cache(dataset_id)
        if state:
            return state

        # If Redis was flushed but still has metadata during a transient error,
        # the stored upload remains a safe last-resort recovery source.
        fp = get_stored_filepath(dataset_id)
        if fp and os.path.exists(fp):
            print(f"Lazy-loading dataset '{dataset_id}' from file {fp}...")
            try:
                return _run_full_analysis(fp, dataset_id)
            except Exception as e:
                raise HTTPException(500, f"Failed to lazy-load dataset '{dataset_id}': {str(e)}")
        raise HTTPException(404, f"Dataset '{dataset_id}' not found. Please upload it first.")
    return analyses[dataset_id]


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/api/simelab/health")
async def health():
    """Health check + loaded datasets."""
    cached_ids = [dataset["id"] for dataset in list_datasets()]
    return {
        "status": "ok",
        "loaded_datasets": list(analyses.keys()),
        "cached_datasets": cached_ids,
        "redis": cache_status(),
        "default_dataset": os.path.basename(DEFAULT_DATASET),
    }


@app.get("/api/simelab/images/{image_path:path}")
async def get_public_image(image_path: str):
    """Serve dataset profile images without exposing the rest of the workspace."""
    filepath = _resolve_public_image(image_path)
    return FileResponse(filepath)


@app.post("/api/simelab/upload", response_model=AnalysisSummary)
async def upload_file(file: UploadFile = File(...)):
    """Upload a NodeXL XLSX or CSV file and run full analysis."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".csv"):
        raise HTTPException(400, f"Unsupported format: {ext}. Use .xlsx or .csv")

    dataset_id = _normalise_dataset_id(file.filename)
    # Stage the upload safely. Every accepted upload is recomputed, even when
    # its filename and content match a prior run; Redis is restore-only.
    dest = UPLOADS_DIR / f"{dataset_id}{ext}"
    staged = UPLOADS_DIR / f".{dataset_id}.{secrets.token_hex(8)}.part"
    try:
        total = 0
        digest = hashlib.sha256()
        with open(staged, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413,
                        f"Upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                digest.update(chunk)
                f.write(chunk)
        source_hash = digest.hexdigest()

        os.replace(staged, dest)
        state = await asyncio.to_thread(_run_full_analysis, str(dest), dataset_id, source_hash)
        return _build_analysis_summary(dataset_id, state)

    except HTTPException:
        staged.unlink(missing_ok=True)
        raise
    except Exception as exc:
        staged.unlink(missing_ok=True)
        logger.exception("Analysis failed for uploaded dataset %s", dataset_id)
        raise HTTPException(500, "Analysis failed. Check the server logs for details.") from exc
    finally:
        await file.close()


def compute_ai_insights(G, sa, da, ha, overall_metrics=None) -> dict:
    from collections import Counter
    import re
    import numpy as np
    import json

    # 1. Platform breakdown
    platforms = [G.nodes[n].get("platform", "Twitter") for n in G.nodes()]
    plat_counts = Counter(platforms)
    total_nodes = len(G) or 1
    platform_breakdown = [
        {"platform": plat, "count": count, "percentage": int(round((count / total_nodes) * 100))}
        for plat, count in plat_counts.items()
    ]
    platform_breakdown.sort(key=lambda x: x["count"], reverse=True)

    # 2. Hashtag trends
    hashtag_counts = Counter()
    hashtag_sentiments = {}
    for n in G.nodes():
        node_tags = G.nodes[n].get("hashtags") or []
        if isinstance(node_tags, str):
            try:
                node_tags = json.loads(node_tags)
            except Exception:
                node_tags = [w.strip("#").lower() for w in node_tags.split() if w.startswith("#")]
        for tag in node_tags:
            hashtag_counts[tag] += 1
            if tag not in hashtag_sentiments:
                hashtag_sentiments[tag] = []
            hashtag_sentiments[tag].append(G.nodes[n].get("sentiment", "Neu"))
            
    hashtag_trends = []
    for tag, count in hashtag_counts.most_common(15):
        sents = hashtag_sentiments.get(tag, [])
        pos_c = sents.count("Pos")
        neg_c = sents.count("Neg")
        dom_sent = "Positive" if pos_c > neg_c else ("Negative" if neg_c > pos_c else "Neutral")
        hashtag_trends.append({
            "hashtag": tag,
            "count": count,
            "sentiment": dom_sent
        })

    # 3. Polarization Index
    polarization_index = 0.0
    if sa:
        polarization_index = sa.polarization_index()

    # 4. Bot activity score
    bot_count = 0
    suspicious_accounts = []
    if da:
        bot_count = sum(1 for n in G.nodes() if da.risk_labels.get(n) in ('likely_disinfo', 'suspicious'))
        sorted_suspicious = sorted(
            [n for n in G.nodes() if da.risk_labels.get(n) in ('likely_disinfo', 'suspicious')],
            key=lambda x: da.scores.get(x, 0.0),
            reverse=True
        )[:5]
        for node in sorted_suspicious:
            reasons = list(da.signals.get(node, {}).keys())
            if not reasons:
                reasons = ["High automation score" if da.risk_labels.get(node) == "likely_disinfo" else "Moderate suspicion"]
            suspicious_accounts.append({
                "id": node,
                "label": G.nodes[node].get("display_name", node),
                "score": float(da.scores.get(node, 0.0)),
                "reasons": reasons
            })
    bot_activity_score = bot_count / max(total_nodes, 1)

    # 5. Timeline Events
    date_counts = Counter()
    for n in G.nodes():
        d = G.nodes[n].get("date")
        if d:
            # handle formats like 2024-06-25T12:00:00 or space-separated
            day = d.split('T')[0].split(' ')[0]
            date_counts[day] += 1
    
    sorted_dates = sorted(date_counts.keys())
    timeline_events = []
    if sorted_dates:
        avg_vol = sum(date_counts.values()) / len(date_counts)
        for day in sorted_dates:
            count = date_counts[day]
            sig = "high" if count > avg_vol * 2.5 else ("medium" if count > avg_vol * 1.5 else "low")
            timeline_events.append({
                "date": day,
                "event": f"Spike in activity ({count} posts)" if count > avg_vol * 2 else f"{count} posts",
                "volume": count,
                "significance": sig
            })
    timeline_events = timeline_events[-10:]

    # 6. Key Narratives
    key_narratives = []
    bigram_counts = Counter()
    bigram_sentiments = {}
    docs = []
    for n in G.nodes():
        text = G.nodes[n].get("tweet_text", "")
        if text and len(text) > 20:
            docs.append((text.lower(), G.nodes[n].get("sentiment", "Neu")))
            
    stops = {
        'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are',
        'was', 'not', 'but', 'you', 'all', 'can', 'had', 'her', 'his',
        'its', 'our', 'out', 'has', 'been', 'were', 'they', 'their', 'will',
        'about', 'what', 'when', 'where', 'which', 'would', 'could', 'should',
        'http', 'https', 'co', 'com', 'just', 'like', 'dont', 'amp', 'via'
    }
    
    for text, sent in docs:
        words = [w for w in re.split(r'\s+', text) if len(w) > 3 and w not in stops]
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i+1]}"
            bigram_counts[bigram] += 1
            if bigram not in bigram_sentiments:
                bigram_sentiments[bigram] = []
            bigram_sentiments[bigram].append(sent)
            
    for bigram, count in bigram_counts.most_common(5):
        sents = bigram_sentiments.get(bigram, [])
        pos_c = sents.count("Pos")
        neg_c = sents.count("Neg")
        dom_sent = "Positive" if pos_c > neg_c else ("Negative" if neg_c > pos_c else "Neutral")
        
        examples = []
        for text, _ in docs:
            if bigram in text:
                examples.append(text)
                if len(examples) >= 2:
                    break
                    
        key_narratives.append({
            "theme": bigram,
            "keywords": bigram.split(),
            "postCount": count,
            "dominantSentiment": dom_sent,
            "examplePosts": examples
        })

    # 7. Summary
    top_node = sorted(G.nodes(), key=lambda x: G.nodes[x].get("degree") or 0, reverse=True)
    top_node_label = G.nodes[top_node[0]].get("display_name", top_node[0]) if top_node else None
    top_node_deg = (G.nodes[top_node[0]].get("degree") or 0) if top_node else 0
    pos_pct = int(round((sum(1 for n in G.nodes() if G.nodes[n].get("sentiment") == "Pos") / max(total_nodes, 1)) * 100))
    theme_str = ", ".join(n["theme"] for n in key_narratives[:3])
    
    summary = f"This dataset contains {total_nodes} accounts and {G.number_of_edges()} connections across the network. " \
              f"The conversation is {pos_pct}% positive overall. "
    if top_node_label:
        summary += f"The most connected account is @{top_node_label} with {top_node_deg} connections. "
    if theme_str:
        summary += f"Key discussion themes include: {theme_str}. "
    if bot_count > 0:
        summary += f"{bot_count} accounts show suspicious activity patterns consistent with automated or coordinated behaviour. "
    
    density = overall_metrics.get("density", 0.0) if overall_metrics else ( (2 * G.number_of_edges()) / (total_nodes * (total_nodes - 1)) if total_nodes > 1 else 0.0)
    summary += f"The network density is {density:.4f}, indicating {'a highly interconnected' if G.number_of_edges() > total_nodes * 2 else 'a loosely connected'} conversation."

    return {
        "summary": summary,
        "keyNarratives": key_narratives,
        "topEvents": timeline_events,
        "suspiciousAccounts": suspicious_accounts,
        "platformBreakdown": platform_breakdown,
        "hashtagTrends": hashtag_trends,
        "botActivityScore": bot_activity_score,
        "polarizationIndex": polarization_index,
    }


@app.get("/api/simelab/analysis-data")
async def get_analysis_data(dataset_id: str = Query("default")):
    """Get the complete graph structure, computed SNA metrics, and AI insights."""
    import json
    state = _get_analysis(dataset_id)
    G = state["G"]
    meta = state["meta"]
    sa = state["sa"]
    da = state["da"]
    ha = state["ha"]

    # 1. Build vertices
    vertices = []
    for n in G.nodes():
        attrs = G.nodes[n]
        v = {
            "id": n,
            "label": attrs.get("display_name", n) or n,
            "degree": attrs.get("degree", 0) or 0,
            "inDegree": attrs.get("in_degree", 0) or 0,
            "outDegree": attrs.get("out_degree", 0) or 0,
            "betweenness": attrs.get("betweenness", 0.0) or 0.0,
            "closeness": attrs.get("closeness", 0.0) or 0.0,
            "eigenvector": attrs.get("eigenvector", 0.0) or 0.0,
            "pagerank": attrs.get("pagerank", 0.0) or 0.0,
            "clusteringCoefficient": attrs.get("clustering_coefficient", 0.0) or 0.0,
            "cluster": attrs.get("cluster", -1) if attrs.get("cluster") is not None else -1,
            "clusterLabel": f"Cluster {attrs.get('cluster') + 1}" if attrs.get("cluster") is not None and attrs.get("cluster") >= 0 else "",
            "sentiment": attrs.get("sentiment", "Neu"),
            "followers": attrs.get("followers", 0) or 0,
            "retweets": attrs.get("retweets", 0) or 0,
            "favorites": attrs.get("favorites", 0) or 0,
            "date": attrs.get("date", "") or "",
            "platform": attrs.get("platform", "Twitter") or "Twitter",
            "topic": attrs.get("topic", "RejectFinanceBill2024") or "RejectFinanceBill2024",
            "tweetText": attrs.get("tweet_text", "") or "",
            "hashtags": list(attrs.get("hashtags", [])) if attrs.get("hashtags") else [],
            "isBot": bool(attrs.get("is_bot", False)),
            "botScore": attrs.get("bot_score", 0.0) or 0.0,
            "image_url": attrs.get("image_url"),
            "x": attrs.get("layout_x", 0.0) or 0.0,
            "y": attrs.get("layout_y", 0.0) or 0.0,
        }
        # Parse hashtags if stored as JSON string
        if isinstance(v["hashtags"], str):
            try:
                v["hashtags"] = json.loads(v["hashtags"])
            except Exception:
                v["hashtags"] = []
        vertices.append(v)

    # 2. Build edges
    edges = []
    for src, tgt, edge_attrs in G.edges(data=True):
        edges.append({
            "source": src,
            "target": tgt,
            "weight": edge_attrs.get("weight", 1.0) or 1.0,
            "date": edge_attrs.get("date", "") or "",
            "relation": edge_attrs.get("edge_type", edge_attrs.get("Relationship", "mention")) or "mention",
        })

    # 3. Build overall metrics
    gs = meta.get("graph_stats", {})
    pos_count = sum(1 for v in vertices if v["sentiment"] == "Pos")
    neu_count = sum(1 for v in vertices if v["sentiment"] == "Neu")
    neg_count = sum(1 for v in vertices if v["sentiment"] == "Neg")

    top_inf_nodes = sorted(vertices, key=lambda x: x["degree"], reverse=True)[:10]
    top_bet_nodes = sorted(vertices, key=lambda x: x["betweenness"], reverse=True)[:10]

    avg_degree = sum(v["degree"] for v in vertices) / max(len(vertices), 1)

    metrics = {
        "totalVertices": len(vertices),
        "totalEdges": len(edges),
        "density": gs.get("density", 0.0) or 0.0,
        "diameter": meta.get("overall_metrics", {}).get("diameter", 0.0) or 0.0,
        "avgClusteringCoefficient": meta.get("overall_metrics", {}).get("avgClusteringCoefficient", 0.0) or 0.0,
        "connectedComponents": gs.get("connected_components", 1) or 1,
        "reciprocity": gs.get("reciprocity", 0.0) or 0.0,
        "avgDegree": avg_degree,
        "sentimentDistribution": {
            "Pos": pos_count,
            "Neu": neu_count,
            "Neg": neg_count,
        },
        "topInfluencers": top_inf_nodes,
        "topBetweenness": top_bet_nodes,
    }

    # 4. Build AI Insights
    ai_ins = compute_ai_insights(G, sa, da, ha, gs)

    return {
        "vertices": vertices,
        "edges": edges,
        "metrics": metrics,
        "ai_insights": ai_ins,
    }


@app.get("/api/simelab/features")
async def get_features(dataset_id: str = Query("default")):
    """Get the 9-D feature matrix."""
    state = _get_analysis(dataset_id)
    fe = state["fe"]
    df = fe.to_dataframe()

    features_list = []
    for node, row in df.iterrows():
        entry = {"node": node}
        entry.update({col: round(float(row[col]), 8) for col in df.columns})
        features_list.append(entry)

    return {
        "dataset_id": dataset_id,
        "node_count": len(features_list),
        "feature_names": list(df.columns),
        "features": features_list,
    }


@app.get("/api/simelab/sentiment")
async def get_sentiment(dataset_id: str = Query("default")):
    """Get k-means sentiment clustering results."""
    state = _get_analysis(dataset_id)
    sa = state["sa"]

    labels_list = [
        {"node": node, "sentiment": label}
        for node, label in sa.labels.items()
    ]

    return {
        "dataset_id": dataset_id,
        "silhouette": round(sa.silhouette, 6) if sa.silhouette is not None else None,
        "silhouette_sample_size": sa.silhouette_sample_size,
        "polarization_index": round(sa.polarization_index(), 4),
        "centroid_distance": round(sa.centroid_distance(), 4),
        "clusters": {
            "Neg": sa.cluster_sizes.get("Neg", 0),
            "Neu": sa.cluster_sizes.get("Neu", 0),
            "Pos": sa.cluster_sizes.get("Pos", 0),
        },
        "labels": labels_list,
    }


@app.get("/api/simelab/disinformation")
async def get_disinformation(dataset_id: str = Query("default")):
    """Get 5-signal disinformation scores."""
    state = _get_analysis(dataset_id)
    da = state["da"]

    scores_arr = list(da.scores.values())
    counts = {"clean": 0, "suspicious": 0, "likely_disinfo": 0}
    for label in da.risk_labels.values():
        counts[label] += 1

    scores_list = []
    for node in da.nodes:
        node_attrs = da.G.nodes[node]
        is_verified = bool(node_attrs.get("verified", False) or node_attrs.get("is_blue_verified", False))
        entry = {
            "node": node,
            "disinfo_score": round(da.scores.get(node, 0), 6),
            "risk_level": da.risk_labels.get(node, "clean"),
            "verified": is_verified,
        }
        if node in da.signals:
            entry.update({k: round(v, 4) for k, v in da.signals[node].items()})
        scores_list.append(entry)

    # Sort by score descending
    scores_list.sort(key=lambda x: x["disinfo_score"], reverse=True)

    return {
        "dataset_id": dataset_id,
        "score_stats": {
            "mean": round(float(sum(scores_arr)/max(len(scores_arr),1)), 6),
            "std": round(float(__import__('numpy').std(scores_arr)), 6) if len(scores_arr) > 1 else 0,
            "min": round(min(scores_arr), 6) if scores_arr else 0,
            "max": round(max(scores_arr), 6) if scores_arr else 0,
        },
        "risk_distribution": counts,
        "scores": scores_list,
    }


@app.get("/api/simelab/censorship")
async def get_censorship(dataset_id: str = Query("default")):
    """Get structural hole analysis results."""
    state = _get_analysis(dataset_id)
    ca = state["ca"]
    G = state["G"]

    holes = []
    for node, si, details in ca.structural_holes:
        holes.append({
            "node": node,
            "display_name": G.nodes[node].get("display_name", ""),
            "si_score": round(si, 6),
            "betweenness": round(details.get("betweenness", 0), 6),
            "degree": details.get("degree", 0),
            "components_after_removal": details.get("components_after_removal", 1),
            "component_increase": details.get("component_increase", 0),
            "is_fragmenting": details.get("is_fragmenting", False),
        })

    return {
        "dataset_id": dataset_id,
        "fiedler_value": round(ca._compute_fiedler(), 6),
        "cvi": round(ca.cvi, 8) if ca.cvi is not None else None,
        "component_count": ca.component_count,
        "largest_component_nodes": ca.largest_component_nodes,
        "largest_component_share": round(ca.largest_component_share, 8),
        "largest_component_fiedler": (
            round(ca.largest_component_fiedler, 8)
            if ca.largest_component_fiedler is not None else None
        ),
        "largest_component_normalized_fiedler": (
            round(ca.largest_component_normalized_fiedler, 8)
            if ca.largest_component_normalized_fiedler is not None else None
        ),
        "largest_component_max_betweenness": (
            round(ca.largest_component_max_betweenness, 10)
            if ca.largest_component_max_betweenness is not None else None
        ),
        "component_cvi": (
            round(ca.component_cvi, 8) if ca.component_cvi is not None else None
        ),
        "structural_holes": holes,
    }


@app.get("/api/simelab/hashtags")
async def get_hashtags(dataset_id: str = Query("default")):
    """Get hashtag lifecycle and authenticity analysis."""
    state = _get_analysis(dataset_id)
    ha = state["ha"]

    authenticity_list = []
    for tag, data in ha.authenticity.items():
        authenticity_list.append({
            "hashtag": tag,
            "score": data["score"],
            "label": data["label"],
            "lifecycle_phase": ha.lifecycle.get(tag, "Unknown"),
        })

    return {
        "dataset_id": dataset_id,
        "hashtag_count": len(ha.lifecycle),
        "artificial_ratio": round(ha.artificial_ratio(), 4),
        "lifecycle": ha.lifecycle,
        "authenticity": authenticity_list,
    }


@app.get("/api/simelab/llm-config")
async def get_llm_config():
    """Report server-side LLM availability without disclosing credentials."""
    provider, key, model, _endpoint = _llm_settings()
    return {"provider": provider, "configured": bool(key), "model": model}


@app.post("/api/simelab/llm/chat")
async def llm_chat(req: LLMChatRequest):
    """Proxy analyst chat through the backend so API keys never reach browsers."""
    content = await asyncio.to_thread(_call_llm, req.user_question.strip(), req.context)
    return {"content": content}


@app.get("/api/simelab/drift")
async def get_semantic_drift(dataset_id: str = Query("default")):
    """Run semantic drift and co-optation analysis on tweet text using LLM."""
    _provider, key_to_use, _model, _endpoint = _llm_settings()
    # Drift can be configured independently because the shared parent .env may
    # contain a higher-priority provider (for example NVIDIA) for other flows.
    deepseek_key = read_env_key("DEEPSEEK_API_KEY")
    if deepseek_key:
        key_to_use = deepseek_key
    if not key_to_use:
        raise HTTPException(503, "Server-side LLM is not configured.")

    state = _get_analysis(dataset_id)
    filepath = state["filepath"]
    network_context = _analysis_metric_context(state)

    try:
        analyzer = SemanticDriftAnalyzer(filepath)
        result = await asyncio.to_thread(
            analyzer.analyze,
            api_key=key_to_use,
            network_context=network_context,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Semantic drift analysis failed for %s", dataset_id)
        raise HTTPException(500, "Semantic drift analysis failed. Check the server logs for details.") from exc

@app.post("/api/simelab/commercial")
async def get_commercial(req: CommercialRequest):
    """Run commercial intent and co-optation analysis."""
    _provider, env_key, _model, _endpoint = _llm_settings()
    if req.use_ai and not env_key:
        raise HTTPException(503, "Server-side LLM is not configured.")
    key_to_use = env_key if req.use_ai else ""

    state = _get_analysis(req.dataset_id)
    filepath = state["filepath"]

    try:
        analyzer = CommercialAnalyzer(filepath)
        result = await asyncio.to_thread(
            analyzer.analyze,
            api_key=key_to_use,
            base_keywords=req.base_keywords,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Commercial analysis failed for %s", req.dataset_id)
        raise HTTPException(500, "Commercial analysis failed. Check the server logs for details.") from exc


@app.post("/api/simelab/compare")
async def compare_datasets(req: CompareRequest):
    """Compare two snapshots to find potential censorship (disappeared critical nodes)."""
    try:
        state1 = _get_analysis(req.dataset_id_1)
        state2 = _get_analysis(req.dataset_id_2)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(400, f"Failed to retrieve datasets: {str(e)}")

    G1 = state1["G"]
    G2 = state2["G"]
    ca1 = state1["ca"]

    # disappeared nodes
    nodes_before = set(G1.nodes())
    nodes_after = set(G2.nodes())
    disappeared = nodes_before - nodes_after

    results = []
    for node in disappeared:
        si = ca1.structural_impact(node)
        cb = ca1.betweenness.get(node, 0.0)
        
        # Calculate degree in G1
        if G1.is_directed():
            deg = G1.in_degree(node) + G1.out_degree(node)
        else:
            deg = G1.degree(node)
            
        display_name = G1.nodes[node].get("display_name", "")

        results.append({
            "node": node,
            "display_name": display_name,
            "si_score": round(si, 6),
            "betweenness": round(cb, 6),
            "degree": deg,
        })

    # Rank by SI descending
    results.sort(key=lambda x: x["si_score"], reverse=True)

    return {
        "dataset_id_1": req.dataset_id_1,
        "dataset_id_2": req.dataset_id_2,
        "disappeared_count": len(disappeared),
        "disappeared_critical_nodes": results,
    }


@app.post("/api/simelab/export")
async def export_results(dataset_id: str = Query("default"), format: str = Query("csv")):
    """Export all analyses to CSV/Excel. Returns download URL."""
    state = _get_analysis(dataset_id)
    G = state["G"]
    fe = state["fe"]
    sa = state["sa"]
    da = state["da"]
    ca = state["ca"]
    ha = state["ha"]

    if format not in {"csv", "xlsx"}:
        raise HTTPException(400, "Unsupported export format.")
    export_dir = tempfile.mkdtemp(prefix="simelab_export_")
    em = ExportManager(output_dir=export_dir)

    try:
        results = await asyncio.to_thread(em.export_all, G, fe, sa, da, ha, ca)
        token = secrets.token_urlsafe(24)
        files = {name: str(Path(path).resolve()) for name, path in results.items()}
        exports_registry[token] = {"files": files, "created": time.time()}
        return {
            "dataset_id": dataset_id,
            "files": {
                name: f"/api/simelab/download/{token}/{Path(path).name}"
                for name, path in results.items()
            },
        }
    except Exception as exc:
        shutil.rmtree(export_dir, ignore_errors=True)
        logger.exception("Export failed for %s", dataset_id)
        raise HTTPException(500, "Export failed. Check the server logs for details.") from exc


@app.get("/api/simelab/download/{token}/{filename}")
async def download_file(token: str, filename: str):
    """Download only files registered by a recent export operation."""
    record = exports_registry.get(token)
    if not record or time.time() - record["created"] > 3600:
        exports_registry.pop(token, None)
        raise HTTPException(404, "File not found")
    if Path(filename).name != filename:
        raise HTTPException(404, "File not found")
    matches = [path for path in record["files"].values() if Path(path).name == filename]
    if len(matches) != 1 or not Path(matches[0]).is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(matches[0], filename=filename)





# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("SIMELAB_PORT", "8000"))
    print(f"SIMElab API starting on http://localhost:{port}")
    print(f"Default dataset: {DEFAULT_DATASET}")

    # ── Auto-restore datasets from Redis on startup (async) ─────────────
    # Run in a background thread so uvicorn starts immediately.
    recovered = list_datasets()
    if recovered:
        print(f"Found {len(recovered)} dataset(s) in Redis — recovering in background...")
        import threading
        def _recover():
            for ds in recovered:
                did = ds["id"]
                print(f"  [bg] Recovering '{did}' from Redis...")
                try:
                    state = _load_analysis_from_cache(did)
                    if state:
                        print(f"  [bg] ✓ Recovered '{did}' from Redis.")
                        continue
                except Exception as e:
                    print(f"  [bg] Redis recovery failed for '{did}': {e}")

                fp = get_stored_filepath(did)
                if fp and os.path.exists(fp):
                    print(f"  [bg] Recovering '{did}' from file {fp}...")
                    try:
                        _run_full_analysis(fp, did)
                        print(f"  [bg] ✓ Recovered '{did}' from file.")
                    except Exception as e:
                        print(f"  [bg] ✗ Recovery of '{did}' failed: {e}")
                else:
                    print(f"  [bg] Skipping '{did}': source file not found at '{fp}'")
        threading.Thread(target=_recover, daemon=True).start()
    else:
        print("  No cached datasets in Redis (fresh start).")

    # Optional pre-load via env var
    if os.environ.get("SIMELAB_PRELOAD") == "1" and os.path.exists(DEFAULT_DATASET):
        if "default" not in analyses:
            print("Pre-loading default dataset in background...")
            import threading
            def _preload():
                try:
                    state = _load_analysis_from_cache("default")
                    if state:
                        print("  Default dataset loaded from Redis.")
                        return
                    _run_full_analysis(DEFAULT_DATASET, "default")
                    print("  Default dataset loaded from file.")
                except Exception as e:
                    print(f"  Warning: Could not pre-load default: {e}")
            threading.Thread(target=_preload, daemon=True).start()
        else:
            print("  Default dataset already recovered from Redis.")
    else:
        print("  Default dataset will lazy-load on first request.")

    host = os.environ.get("SIMELAB_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)
