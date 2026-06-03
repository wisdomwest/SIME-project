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
import tempfile
import shutil
from pathlib import Path
from typing import Optional

# Ensure simelab package is importable
sys.path.insert(0, str(Path(__file__).parent))

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

# ─── State ───────────────────────────────────────────────────────────────────
# In-memory analysis cache: dataset_id → {G, meta, fe, sa, da, ca, ha}
analyses: dict = {}

# Default dataset (RejectFinanceBill2024)
DEFAULT_DATASET = str(Path(__file__).parent.parent.parent / "RejectFinanceBill2024.xlsx")


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
    return state


def _get_analysis(dataset_id: str) -> dict:
    """Get cached analysis or raise 404."""
    if dataset_id not in analyses:
        # Auto-load default on first request
        if dataset_id == "default" and os.path.exists(DEFAULT_DATASET):
            return _run_full_analysis(DEFAULT_DATASET, "default")
        raise HTTPException(404, f"Dataset '{dataset_id}' not found. Upload first.")
    return analyses[dataset_id]


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/api/simelab/health")
async def health():
    """Health check + loaded datasets."""
    return {
        "status": "ok",
        "loaded_datasets": list(analyses.keys()),
        "default_dataset": os.path.basename(DEFAULT_DATASET),
    }


@app.post("/api/simelab/upload", response_model=AnalysisSummary)
async def upload_file(file: UploadFile = File(...)):
    """Upload a NodeXL XLSX or CSV file and run full analysis."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    # Save to temp
    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".csv"):
        raise HTTPException(400, f"Unsupported format: {ext}. Use .xlsx or .csv")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        shutil.copyfileobj(file.file, tmp)
        tmp.close()

        dataset_id = Path(file.filename).stem
        state = _run_full_analysis(tmp.name, dataset_id)

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
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


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
        entry = {
            "node": node,
            "disinfo_score": round(da.scores.get(node, 0), 6),
            "risk_level": da.risk_labels.get(node, "clean"),
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
    print(f"Preload: set SIMELAB_PRELOAD=1 to pre-load default on startup")

    # Optional pre-load via env var
    if os.environ.get("SIMELAB_PRELOAD") == "1" and os.path.exists(DEFAULT_DATASET):
        print("Pre-loading default dataset (this may take ~60s)...")
        try:
            _run_full_analysis(DEFAULT_DATASET, "default")
            print("  Default dataset loaded.")
        except Exception as e:
            print(f"  Warning: Could not pre-load default: {e}")
    else:
        print("  Default dataset will lazy-load on first request.")

    uvicorn.run(app, host="0.0.0.0", port=port)
