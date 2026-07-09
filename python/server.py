"""
server.py — FastAPI backend for SIMElab Data Explorer.

Serves the Python analysis engine behind the Vite proxy.
All endpoints live under /api/simelab/* and are proxied by Vite dev server.

Usage:
    cd SIME-project && python python/server.py
    # Starts on http://localhost:8000
    # Vite proxies /api/simelab/* → http://localhost:8000/api/simelab/*
"""

import sys
import os
import shutil
from pathlib import Path
from typing import Optional

# Ensure simelab package is importable
sys.path.insert(0, str(Path(__file__).parent))

def load_env():
    # Try multiple paths to find .env file
    paths = [
        Path(__file__).parent.parent.parent / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent / ".env",
        Path.cwd() / ".env",
    ]
    for p in paths:
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
                        os.environ[k] = v
            break

load_env()


def read_env_key(key: str, default: str = "") -> str:
    paths = [
        Path(__file__).parent.parent.parent / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent / ".env",
        Path.cwd() / ".env",
    ]
    for p in paths:
        if p.exists():
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
    return os.environ.get(key, default)

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

from simelab.loader import load_nodexl
from simelab.features import FeatureEngineer, INFLUENCE
from simelab.sentiment import SentimentAnalyzer
from simelab.disinformation import DisinformationAnalyzer
from simelab.censorship import CensorshipAnalyzer
from simelab.export import ExportManager
from simelab.drift import SemanticDriftAnalyzer
from simelab.commercial import CommercialAnalyzer

from simelab.database import (
    save_full_analysis, get_dataset_meta, list_datasets,
    get_stored_filepath, delete_dataset,
)

from fastapi.staticfiles import StaticFiles

# ─── App Setup ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="SIMElab Data Explorer API",
    description="Python analysis engine for social media network data",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount workspace directory for static images
app.mount("/api/simelab/images", StaticFiles(directory="/home/west/sime-lab-usiu"), name="images")

# ─── State ───────────────────────────────────────────────────────────────────
# In-memory analysis cache: dataset_id → {G, meta, fe, sa, da, ca, ha}
analyses: dict = {}

# Default dataset (RejectFinanceBill2024)
DEFAULT_DATASET = str(Path(__file__).parent.parent.parent / "RejectFinanceBill2024.xlsx")

# Persistent uploads directory — files must survive beyond the request so
# long-running endpoints like /drift can re-open them.
UPLOADS_DIR = Path(__file__).parent.parent.parent / "files" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ─── Pydantic Models ─────────────────────────────────────────────────────────

class AnalysisSummary(BaseModel):
    dataset_id: str
    nodes: int
    edges: int
    density: float
    components: int
    reciprocity: Optional[float] = None
    edge_types: dict = {}
    top_influencers: list = []


class FeatureResponse(BaseModel):
    dataset_id: str
    node_count: int
    feature_names: list
    features: list  # list of {node, ...features}


class SentimentResponse(BaseModel):
    dataset_id: str
    silhouette: Optional[float]
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
    cvi: float
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


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _run_full_analysis(filepath: str, dataset_id: str) -> dict:
    """Run the full analysis pipeline on a file. Returns state dict."""
    G, meta = load_nodexl(filepath)

    fe = FeatureEngineer(G)
    fe.build_matrix()

    sa = SentimentAnalyzer(fe)
    sa.fit()

    da = DisinformationAnalyzer(G, fe)
    da.score_all()

    ca = CensorshipAnalyzer(G)
    ca.find_structural_holes(k=20)
    ca.censorship_vulnerability_index()

    # Hashtags (non-critical, may fail if no text)
    try:
        import pandas as pd
        edges_df = pd.read_excel(filepath, sheet_name="Edges", header=1)
    except Exception:
        edges_df = None

    from simelab.hashtag import HashtagAnalyzer
    ha = HashtagAnalyzer(G, edges_df)
    ha.detect_lifecycle()
    ha.score_hashtags()

    # Store Fiedler value and CVI in overall_metrics for direct database loading later
    meta.setdefault("overall_metrics", {})
    meta["overall_metrics"]["fiedler_value"] = ca._compute_fiedler()
    meta["overall_metrics"]["cvi"] = ca.cvi

    state = {
        "G": G,
        "meta": meta,
        "fe": fe,
        "sa": sa,
        "da": da,
        "ca": ca,
        "ha": ha,
        "filepath": filepath,
    }
    analyses[dataset_id] = state

    # Persist to SQLite so results survive a server restart
    _save_analysis_to_sqlite(dataset_id, state)

    return state


def _load_analysis_from_db(dataset_id: str) -> Optional[dict]:
    """Reconstruct the analysis state dictionary directly from SQLite database."""
    try:
        from simelab.database import (
            get_dataset_meta, load_vertices, load_edges,
            load_disinfo_scores, load_hashtags, load_structural_holes
        )
        import json
        import networkx as nx
        import numpy as np

        meta_row = get_dataset_meta(dataset_id)
        if not meta_row:
            return None

        # Load rows from SQLite
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
                    attrs["hashtags"] = json.loads(v["hashtags_json"])
                except Exception:
                    pass
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
            def __init__(self, fe, vertices_rows):
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
                from sklearn.metrics import silhouette_score
                if len(set(self.cluster_ids)) > 1:
                    try:
                        self.silhouette = float(silhouette_score(self.X_norm, self.cluster_ids))
                    except Exception:
                        self.silhouette = None
                else:
                    self.silhouette = None

            def polarization_index(self) -> float:
                extreme = self.cluster_sizes.get("Pos", 0) + self.cluster_sizes.get("Neg", 0)
                return extreme / max(self.n, 1)

            def centroid_distance(self) -> float:
                pos_cid = 0
                neg_cid = 2
                return float(np.linalg.norm(self.centroids[pos_cid] - self.centroids[neg_cid]))

        sa = MockSentimentAnalyzer(fe, vertices_rows)

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
            def __init__(self, G, holes_rows, fiedler_val, cvi_val):
                self.G = G
                self.fiedler_value = fiedler_val
                self.cvi = cvi_val
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

        fiedler_val = meta.get("overall_metrics", {}).get("fiedler_value", 0.05)
        cvi_val = meta.get("overall_metrics", {}).get("cvi", 10.0)
        ca = MockCensorshipAnalyzer(G, holes_rows, fiedler_val, cvi_val)

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
        return state

    except Exception as ex:
        print(f"Error reconstructing analysis from SQLite for '{dataset_id}': {ex}")
        return None


def _save_analysis_to_sqlite(dataset_id: str, state: dict):
    """Serialize analysis state to the SQLite database."""
    try:
        G = state["G"]
        meta = state["meta"]
        fe = state["fe"]
        sa = state["sa"]
        da = state["da"]
        ca = state["ca"]
        ha = state["ha"]

        # Pre-compute feature dict once
        fe_dict = fe.to_dict()

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
            # Sentiment label
            v["sentiment"] = sa.labels.get(node, "unknown")
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

        save_full_analysis(dataset_id, meta, serializable)
        print(f"  [db] Saved analysis '{dataset_id}' to simelab.db ({len(vertices_serial)} vertices, {len(edges_serial)} edges)")
    except Exception as e:
        print(f"  [db] Warning: could not save '{dataset_id}' to SQLite: {e}")


def _get_analysis(dataset_id: str) -> dict:
    """Get cached analysis or raise 404."""
    if dataset_id not in analyses:
        # Try loading directly from SQLite
        state = _load_analysis_from_db(dataset_id)
        if state:
            return state

        # Fallback to recovering from Excel/CSV file if not in DB (or DB load failed)
        from simelab.database import get_stored_filepath
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
    # Also list datasets stored in SQLite for recovery awareness
    db_datasets = list_datasets()
    db_ids = [d["id"] for d in db_datasets]
    return {
        "status": "ok",
        "loaded_datasets": list(analyses.keys()),
        "db_datasets": db_ids,
        "default_dataset": os.path.basename(DEFAULT_DATASET),
    }


@app.post("/api/simelab/upload", response_model=AnalysisSummary)
async def upload_file(file: UploadFile = File(...)):
    """Upload a NodeXL XLSX or CSV file and run full analysis."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".csv"):
        raise HTTPException(400, f"Unsupported format: {ext}. Use .xlsx or .csv")

    dataset_id = Path(file.filename).stem
    # Save permanently so endpoints like /drift can re-read the file later
    dest = UPLOADS_DIR / f"{dataset_id}{ext}"
    try:
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)

        state = _run_full_analysis(str(dest), dataset_id)

        # Build summary
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
        )

    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {str(e)}")


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
        node_tags = G.nodes[n].get("hashtags", [])
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
    top_node = sorted(G.nodes(), key=lambda x: G.nodes[x].get("degree", 0), reverse=True)
    top_node_label = G.nodes[top_node[0]].get("display_name", top_node[0]) if top_node else None
    top_node_deg = G.nodes[top_node[0]].get("degree", 0) if top_node else 0
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
        "silhouette": round(sa.silhouette, 6) if sa.silhouette else None,
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
        "cvi": round(ca.cvi, 4) if ca.cvi else None,
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
    """Get backend-configured LLM provider and key from environment."""
    nv_key = read_env_key("NVIDIA_API_KEY")
    ds_key = read_env_key("DEEPSEEK_API_KEY")
    tr_key = read_env_key("TOKENROUTER_API_KEY")
    if tr_key:
        return {"provider": "tokenrouter", "apiKey": tr_key}
    elif nv_key:
        return {"provider": "nvidia-nim", "apiKey": nv_key}
    elif ds_key:
        return {"provider": "deepseek", "apiKey": ds_key}
    return {"provider": "deepseek", "apiKey": ""}


@app.get("/api/simelab/drift")
async def get_semantic_drift(dataset_id: str = Query("default"), api_key: str = Query("")):
    """Run semantic drift and co-optation analysis on tweet text using LLM."""
    env_key = read_env_key("TOKENROUTER_API_KEY") or read_env_key("NVIDIA_API_KEY") or read_env_key("DEEPSEEK_API_KEY")
    key_to_use = api_key or env_key
    if not key_to_use:
        raise HTTPException(400, "API key is required. Set it in settings or in the backend .env file.")

    state = _get_analysis(dataset_id)
    filepath = state["filepath"]

    try:
        analyzer = SemanticDriftAnalyzer(filepath)
        result = analyzer.analyze(api_key=key_to_use)
        return result
    except Exception as e:
        raise HTTPException(500, f"Semantic drift analysis failed: {str(e)}")


class CommercialRequest(BaseModel):
    dataset_id: str = "default"
    api_key: str = ""
    base_keywords: str = ""
    use_ai: bool = True

@app.post("/api/simelab/commercial")
async def get_commercial(req: CommercialRequest):
    """Run commercial intent and co-optation analysis."""
    env_key = read_env_key("TOKENROUTER_API_KEY") or read_env_key("NVIDIA_API_KEY") or read_env_key("DEEPSEEK_API_KEY")
    key_to_use = req.api_key if req.api_key else (env_key if req.use_ai else "")

    state = _get_analysis(req.dataset_id)
    filepath = state["filepath"]

    try:
        analyzer = CommercialAnalyzer(filepath)
        result = analyzer.analyze(api_key=key_to_use, base_keywords=req.base_keywords)
        return result
    except Exception as e:
        raise HTTPException(500, f"Commercial analysis failed: {str(e)}")


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

    export_dir = tempfile.mkdtemp(prefix="simelab_export_")
    em = ExportManager(output_dir=export_dir)

    try:
        results = em.export_all(G, fe, sa, da, ha, ca)
        return {
            "dataset_id": dataset_id,
            "files": {name: os.path.basename(path) for name, path in results.items()},
            "export_dir": export_dir,
        }
    except Exception as e:
        raise HTTPException(500, f"Export failed: {str(e)}")


@app.get("/api/simelab/download/{filename}")
async def download_file(filename: str, export_dir: str = Query("")):
    """Download an exported file."""
    filepath = os.path.join(export_dir, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found")
    return FileResponse(filepath, filename=filename)





# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("SIMELAB_PORT", "8000"))
    print(f"SIMElab API starting on http://localhost:{port}")
    print(f"Default dataset: {DEFAULT_DATASET}")

    # ── Auto-restore datasets from SQLite on startup (async) ────────────
    # Run in a background thread so uvicorn starts immediately.
    recovered = list_datasets()
    if recovered:
        print(f"Found {len(recovered)} dataset(s) in simelab.db — recovering in background...")
        import threading
        def _recover():
            for ds in recovered:
                did = ds["id"]
                print(f"  [bg] Recovering '{did}' from SQLite...")
                try:
                    state = _load_analysis_from_db(did)
                    if state:
                        print(f"  [bg] ✓ Recovered '{did}' from SQLite.")
                        continue
                except Exception as e:
                    print(f"  [bg] SQLite recovery failed for '{did}': {e}")

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
        print("  No previous datasets in simelab.db (fresh start).")

    # Optional pre-load via env var
    if os.environ.get("SIMELAB_PRELOAD") == "1" and os.path.exists(DEFAULT_DATASET):
        if "default" not in analyses:
            print("Pre-loading default dataset in background...")
            import threading
            def _preload():
                try:
                    state = _load_analysis_from_db("default")
                    if state:
                        print("  Default dataset loaded from SQLite.")
                        return
                    _run_full_analysis(DEFAULT_DATASET, "default")
                    print("  Default dataset loaded from file.")
                except Exception as e:
                    print(f"  Warning: Could not pre-load default: {e}")
            threading.Thread(target=_preload, daemon=True).start()
        else:
            print("  Default dataset already recovered from SQLite.")
    else:
        print("  Default dataset will lazy-load on first request.")

    uvicorn.run(app, host="0.0.0.0", port=port)
