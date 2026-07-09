"""
database.py — SQLite persistence for SIMElab analysis results.

Allows analysis results to survive Python server restarts.
The frontend IndexedDB handles browser-session persistence;
this handles backend-side caching across server restarts.
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DB_PATH = Path(__file__).parent.parent / "simelab.db"


# ─── JSON helpers (handle numpy types, datetime, etc.) ───────────────────────

def safe_json(val):
    """Convert a value to JSON-safe form. Handles numpy types, datetime, etc."""
    import json

    class _Encoder(json.JSONEncoder):
        def default(self, o):
            if hasattr(o, "isoformat"):  # datetime, date, time
                return o.isoformat()
            try:
                return float(o)
            except (TypeError, ValueError):
                return str(o)

    return json.dumps(val, cls=_Encoder)


# ─── Connection ──────────────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    """Get a thread-safe SQLite connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ─── Migration (runs once on import) ─────────────────────────────────────────

def _run_migrations():
    """Ensure schema columns exist after initial CREATE TABLE."""
    conn = get_conn()
    try:
        cur = conn.execute("PRAGMA table_info(datasets)")
        cols = {row["name"] for row in cur.fetchall()}
        added = []
        if "filepath" not in cols:
            conn.execute("ALTER TABLE datasets ADD COLUMN filepath TEXT")
            added.append("filepath")
        if added:
            print(f"  [db] Migrated datasets table: added {', '.join(added)}")
        conn.commit()
    except Exception:
        pass  # Table may not exist yet — that's fine
    finally:
        conn.close()


_run_migrations()


# ─── Dataset CRUD ────────────────────────────────────────────────────────────

def save_dataset_meta(
    dataset_id: str,
    name: str,
    filepath: str,
    nodes_count: int,
    edges_count: int,
    density: float,
    reciprocity: Optional[float],
    components: int,
    edge_types_json: str,
    overall_metrics_json: Optional[str] = None,
    ai_insights_json: Optional[str] = None,
):
    """Insert or replace dataset metadata."""
    conn = get_conn()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO datasets
               (id, name, filepath, nodes_count, edges_count, density,
                reciprocity, components, edge_types_json, overall_metrics_json,
                ai_insights_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, COALESCE((SELECT created_at FROM datasets WHERE id=?), CURRENT_TIMESTAMP))""",
            (
                dataset_id, name, filepath,
                nodes_count, edges_count, density,
                reciprocity, components, edge_types_json, overall_metrics_json,
                ai_insights_json, dataset_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_dataset_meta(dataset_id: str) -> Optional[Dict[str, Any]]:
    """Get dataset metadata row, or None."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
        if row is None:
            return None
        return dict(row)
    finally:
        conn.close()


def list_datasets() -> List[Dict[str, Any]]:
    """List all stored datasets."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, nodes_count, edges_count, created_at FROM datasets ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_dataset(dataset_id: str):
    """Delete a dataset and all its related analysis rows (cascade)."""
    conn = get_conn()
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()
    finally:
        conn.close()


# ─── Vertices ────────────────────────────────────────────────────────────────

def save_vertices(dataset_id: str, vertices: List[Dict[str, Any]]):
    """Batch insert vertex data."""
    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM vertices WHERE dataset_id = ?", (dataset_id,))
        for v in vertices:
            conn.execute(
                """INSERT INTO vertices
                   (dataset_id, id, label, degree, in_degree, out_degree,
                    betweenness, closeness, eigenvector, pagerank,
                    clustering_coefficient, cluster, sentiment,
                    followers, retweets, favorites, date, platform,
                    topic, tweet_text, hashtags_json,
                    is_bot, bot_score, layout_x, layout_y, features_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                           ?, ?, ?, ?, ?, ?)""",
                (
                    dataset_id,
                    v.get("id"),
                    v.get("label"),
                    v.get("degree"),
                    v.get("in_degree"),
                    v.get("out_degree"),
                    v.get("betweenness"),
                    v.get("closeness"),
                    v.get("eigenvector"),
                    v.get("pagerank"),
                    v.get("clustering_coefficient"),
                    v.get("cluster"),
                    v.get("sentiment"),
                    v.get("followers"),
                    v.get("retweets"),
                    v.get("favorites"),
                    v.get("date"),
                    v.get("platform"),
                    v.get("topic"),
                    v.get("tweet_text"),
                    safe_json(v.get("hashtags", [])) if v.get("hashtags") else None,
                    1 if v.get("is_bot") else 0,
                    v.get("bot_score"),
                    v.get("layout_x"),
                    v.get("layout_y"),
                    safe_json(v.get("features", {})) if v.get("features") else None,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Edges ───────────────────────────────────────────────────────────────────

def save_edges(dataset_id: str, edges: List[Dict[str, Any]]):
    """Batch insert edge data."""
    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM edges WHERE dataset_id = ?", (dataset_id,))
        for e in edges:
            conn.execute(
                """INSERT INTO edges (dataset_id, source, target, weight, date, relation)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    dataset_id,
                    e.get("source"),
                    e.get("target"),
                    e.get("weight"),
                    e.get("date"),
                    e.get("relation"),
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Disinfo Scores ──────────────────────────────────────────────────────────

def save_disinfo_scores(dataset_id: str, scores: List[Dict[str, Any]]):
    """Batch insert disinformation analysis results."""
    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM disinfo_scores WHERE dataset_id = ?", (dataset_id,))
        for s in scores:
            conn.execute(
                """INSERT INTO disinfo_scores (dataset_id, node, disinfo_score, risk_level, signals_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    dataset_id,
                    s.get("node"),
                    s.get("disinfo_score"),
                    s.get("risk_level"),
                    safe_json(s.get("signals", {})),
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Hashtags ────────────────────────────────────────────────────────────────

def save_hashtags(dataset_id: str, hashtags: List[Dict[str, Any]]):
    """Batch insert hashtag analysis results."""
    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM hashtags WHERE dataset_id = ?", (dataset_id,))
        for h in hashtags:
            conn.execute(
                """INSERT INTO hashtags (dataset_id, hashtag, score, label, lifecycle_phase)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    dataset_id,
                    h.get("hashtag"),
                    h.get("score"),
                    h.get("label"),
                    h.get("lifecycle_phase"),
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Structural Holes ────────────────────────────────────────────────────────

def save_structural_holes(dataset_id: str, holes: List[Dict[str, Any]]):
    """Batch insert structural hole analysis results."""
    conn = get_conn()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM structural_holes WHERE dataset_id = ?", (dataset_id,))
        for h in holes:
            conn.execute(
                """INSERT INTO structural_holes
                   (dataset_id, node, display_name, si_score, betweenness,
                    degree, components_after_removal, component_increase, is_fragmenting)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    dataset_id,
                    h.get("node"),
                    h.get("display_name"),
                    h.get("si_score"),
                    h.get("betweenness"),
                    h.get("degree"),
                    h.get("components_after_removal"),
                    h.get("component_increase"),
                    1 if h.get("is_fragmenting") else 0,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Load helpers (for server startup recovery) ─────────────────────────────

def get_stored_filepath(dataset_id: str) -> Optional[str]:
    """Get the filepath for a stored dataset, if it still exists on disk."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT filepath FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
        if row is None:
            return None
        fp = row["filepath"]
        return fp if os.path.exists(fp) else None
    finally:
        conn.close()


def save_full_analysis(
    dataset_id: str,
    meta: Dict[str, Any],
    G_serializable: Dict[str, Any],
):
    """Save a complete analysis run to the database.

    Args:
        dataset_id: Unique dataset ID.
        meta: Dataset metadata (from loader) plus graph_stats.
        G_serializable: Dict with keys:
            - graph_stats: graph-level stats
            - vertices: list of vertex dicts
            - edges: list of edge dicts
            - disinfo_scores: list of disinfo score dicts
            - hashtags: list of hashtag analysis dicts
            - structural_holes: list of structural hole dicts
            - sentiment_labels: list of {node, sentiment} dicts
            - cluster_sizes: dict of cluster counts
            - features: list of {node, ...feature} dicts
    """
    gs = G_serializable
    graph_stats = meta.get("graph_stats", {})

    save_dataset_meta(
        dataset_id=dataset_id,
        name=meta.get("filename", dataset_id),
        filepath=meta.get("filepath", ""),
        nodes_count=graph_stats.get("node_count", 0),
        edges_count=graph_stats.get("edge_count", 0),
        density=graph_stats.get("density", 0.0),
        reciprocity=graph_stats.get("reciprocity"),
        components=graph_stats.get("connected_components", 0),
        edge_types_json=safe_json(graph_stats.get("edge_types", {})),
        overall_metrics_json=safe_json(meta.get("overall_metrics", {})) if meta.get("overall_metrics") else None,
    )

    save_vertices(dataset_id, gs.get("vertices", []))
    save_edges(dataset_id, gs.get("edges", []))
    save_disinfo_scores(dataset_id, gs.get("disinfo_scores", []))
    save_hashtags(dataset_id, gs.get("hashtags", []))
    save_structural_holes(dataset_id, gs.get("structural_holes", []))


# ─── Load helpers (reconstruct cache from SQLite) ───────────────────────────

def load_vertices(dataset_id: str) -> List[Dict[str, Any]]:
    """Load all vertices for a dataset from SQLite."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM vertices WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def load_edges(dataset_id: str) -> List[Dict[str, Any]]:
    """Load all edges for a dataset from SQLite."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM edges WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def load_disinfo_scores(dataset_id: str) -> List[Dict[str, Any]]:
    """Load disinformation scores from SQLite."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM disinfo_scores WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def load_hashtags(dataset_id: str) -> List[Dict[str, Any]]:
    """Load hashtags from SQLite."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM hashtags WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def load_structural_holes(dataset_id: str) -> List[Dict[str, Any]]:
    """Load structural holes from SQLite."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM structural_holes WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

