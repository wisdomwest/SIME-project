"""
sentiment.py — K-Means clustering on 9-D network feature vectors.

Algorithm (from SIMElab research methodology):
- k-means++ with k=3 on 9-D normalized feature vectors
- Post-cluster labeling: max out-degree + min reciprocity → "Neg" (angry broadcasters),
  max reciprocity + max betweenness → "Pos" (reciprocal connectors), remainder → "Neu"
- Validation: silhouette score
- Centroid tracking for polarization / radicalization detection

Usage:
    from sentiment import SentimentAnalyzer
    sa = SentimentAnalyzer(fe)
    labels = sa.fit()           # Dict[node → "Pos"|"Neu"|"Neg"]
    sa.print_report()
"""

from typing import Dict, List, Tuple, Optional
import warnings

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import MinMaxScaler

try:
    from .features import FeatureEngineer, FEATURE_NAMES, FEATURE_LABELS
except ImportError:
    from features import FeatureEngineer, FEATURE_NAMES, FEATURE_LABELS

# Dimension indices (must match features.py)
DEGREE = 0
BETWEENNESS = 1
CLOSENESS = 2
EIGENVECTOR = 3
PAGERANK = 4
CLUSTERING = 5
RECIPROCITY = 6
FOLLOWER_RATIO = 7
INFLUENCE = 8


class SentimentAnalyzer:
    """
    Cluster nodes by network behavior into Positive, Neutral, or Negative sentiment.

    No text needed — purely structural classification based on how accounts
    interact in the network. High out-degree + low reciprocity → broadcast anger.
    High reciprocity + betweenness → genuine conversation.
    """

    SENTIMENT_COLORS = {
        "Pos": "#4CAF50",   # Green
        "Neu": "#9E9E9E",   # Grey
        "Neg": "#F44336",   # Red
    }

    def __init__(self, fe: FeatureEngineer):
        self.fe = fe
        self.matrix = fe.build_matrix()
        self.nodes = fe.get_nodes()
        self.n = len(self.nodes)

        # Normalize features to [0, 1]
        self.scaler = MinMaxScaler()
        self.X_norm = self.scaler.fit_transform(self.matrix)

        # Results
        self.kmeans: Optional[KMeans] = None
        self.labels: Optional[Dict[str, str]] = None     # node → "Pos"|"Neu"|"Neg"
        self.cluster_ids: Optional[np.ndarray] = None     # raw k-means cluster (0,1,2)
        self.centroids: Optional[np.ndarray] = None       # 3 × 9 cluster centers
        self.silhouette: Optional[float] = None
        self.cluster_sizes: Dict[str, int] = {}

    def fit(self, k: int = 3, random_state: int = 42) -> Dict[str, str]:
        """
        Fit k-means and assign sentiment labels.

        Args:
            k: Number of clusters (default 3: Pos/Neu/Neg)
            random_state: Seed for reproducibility

        Returns:
            Dict mapping node name → "Pos" | "Neu" | "Neg"
        """
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.kmeans = KMeans(n_clusters=k, init="k-means++", n_init=10,
                                 max_iter=300, random_state=random_state)
            self.cluster_ids = self.kmeans.fit_predict(self.X_norm)

        self.centroids = self.kmeans.cluster_centers_

        # Silhouette score
        if k > 1 and len(set(self.cluster_ids)) > 1:
            self.silhouette = silhouette_score(self.X_norm, self.cluster_ids)
        else:
            self.silhouette = None

        # Post-cluster labeling
        self._label_clusters()
        return self.labels

    def _label_clusters(self) -> None:
        """
        Label each k-means cluster as Pos, Neu, or Neg using network metrics:
        - Neg: highest out-degree centrality + lowest reciprocity (angry broadcasters)
        - Pos: highest reciprocity + highest betweenness (genuine connectors)
        - Neu: everything else
        """
        cluster_map = {}  # raw_id → "Pos"|"Neu"|"Neg"

        # For each cluster, compute mean out-degree and mean reciprocity
        cluster_stats = {}
        for cid in range(self.kmeans.n_clusters):
            mask = self.cluster_ids == cid
            cluster_stats[cid] = {
                "mean_out_degree": self.matrix[mask, DEGREE].mean(),
                "mean_reciprocity": self.matrix[mask, RECIPROCITY].mean(),
                "mean_betweenness": self.matrix[mask, BETWEENNESS].mean(),
                "size": mask.sum(),
            }

        # Neg: max(out_degree) AND min(reciprocity)
        # Score = out_degree - reciprocity (broadcasters with no back-and-forth)
        neg_scores = {
            cid: stats["mean_out_degree"] - stats["mean_reciprocity"]
            for cid, stats in cluster_stats.items()
        }
        neg_cluster = max(neg_scores, key=neg_scores.get)

        # Pos: max(reciprocity) AND max(betweenness)
        pos_scores = {
            cid: stats["mean_reciprocity"] + stats["mean_betweenness"]
            for cid, stats in cluster_stats.items()
            if cid != neg_cluster
        }
        if pos_scores:
            pos_cluster = max(pos_scores, key=pos_scores.get)
        else:
            pos_cluster = neg_cluster  # fallback

        # Assign labels
        for cid in range(self.kmeans.n_clusters):
            if cid == neg_cluster:
                cluster_map[cid] = "Neg"
            elif cid == pos_cluster:
                cluster_map[cid] = "Pos"
            else:
                cluster_map[cid] = "Neu"

        # Build node → label dict
        self.labels = {
            self.nodes[i]: cluster_map[self.cluster_ids[i]]
            for i in range(self.n)
        }

        # Cluster sizes
        self.cluster_sizes = {
            label: sum(1 for l in self.labels.values() if l == label)
            for label in ["Pos", "Neu", "Neg"]
        }

    def get_label(self, node: str) -> str:
        """Get sentiment label for a node. Returns 'Neu' if unknown."""
        if self.labels is None:
            self.fit()
        return self.labels.get(node, "Neu")

    def get_cluster_nodes(self, label: str) -> List[str]:
        """Get all nodes in a given sentiment cluster."""
        if self.labels is None:
            self.fit()
        return [n for n, l in self.labels.items() if l == label]

    def centroid_distance(self) -> float:
        """
        Distance between Pos and Neg centroids.
        > 3.0 in normalized space → highly polarized discourse.
        < 1.0 → unreliable sentiment classification from structure alone.
        """
        if self.centroids is None:
            return 0.0
        neg_idx = {"Pos": 0, "Neu": 1, "Neg": 2}
        # Find which cluster is which
        cluster_labels = {}
        for cid in range(self.kmeans.n_clusters):
            nodes_in_cluster = [n for i, n in enumerate(self.nodes)
                                if self.cluster_ids[i] == cid]
            # Sample label from nodes
            if nodes_in_cluster:
                cluster_labels[cid] = self.labels[nodes_in_cluster[0]]

        pos_cid = next((c for c, l in cluster_labels.items() if l == "Pos"), None)
        neg_cid = next((c for c, l in cluster_labels.items() if l == "Neg"), None)

        if pos_cid is not None and neg_cid is not None:
            return float(np.linalg.norm(self.centroids[pos_cid] - self.centroids[neg_cid]))
        return 0.0

    def polarization_index(self) -> float:
        """
        Polarization index: fraction of nodes in extreme clusters (Pos + Neg).
        High values → few neutral observers, everyone has taken a side.
        """
        if self.labels is None:
            self.fit()
        extreme = self.cluster_sizes.get("Pos", 0) + self.cluster_sizes.get("Neg", 0)
        return extreme / max(self.n, 1)

    def to_dataframe(self):
        """Return DataFrame with nodes and their sentiment labels."""
        import pandas as pd
        if self.labels is None:
            self.fit()
        return pd.DataFrame({
            "node": list(self.labels.keys()),
            "sentiment": list(self.labels.values()),
        }).set_index("node")

    def print_report(self) -> str:
        """Human-readable sentiment analysis report."""
        if self.labels is None:
            self.fit()

        lines = []
        lines.append("Sentiment Analysis (k-means on 9-D Network Features)")
        lines.append("=" * 60)

        for label in ["Neg", "Neu", "Pos"]:
            count = self.cluster_sizes.get(label, 0)
            pct = count / max(self.n, 1) * 100
            lines.append(f"  {label}: {count} nodes ({pct:.1f}%)")

        if self.silhouette is not None:
            lines.append(f"\nSilhouette Score: {self.silhouette:.4f}")
            quality = "Good" if self.silhouette > 0.5 else \
                      "Fair" if self.silhouette > 0.3 else "Poor"
            lines.append(f"  Clustering quality: {quality}")
            if self.silhouette < 0.3:
                lines.append("  ⚠ Sentiment from network structure alone is unreliable")

        dist = self.centroid_distance()
        lines.append(f"\nPos—Neg Centroid Distance: {dist:.4f}")
        if dist > 3.0:
            lines.append("  🔴 Highly polarized discourse")
        elif dist < 1.0:
            lines.append("  ⚠ Sentiment classification from structure is unreliable")
        else:
            lines.append("  🟡 Moderate polarization")

        pi = self.polarization_index()
        lines.append(f"\nPolarization Index: {pi:.3f} ({pi*100:.1f}% in extreme clusters)")

        # Sample nodes from each cluster
        for label in ["Neg", "Pos", "Neu"]:
            nodes = self.get_cluster_nodes(label)
            sample = nodes[:5]
            lines.append(f"\nTop {label} nodes (of {len(nodes)}):")
            for node in sample:
                deg = self.fe.G.nodes[node].get("degree_centrality", 0)
                name = self.fe.G.nodes[node].get("display_name", "")
                lines.append(f"  @{node}  deg={deg:.4f}  '{name}'")

        return "\n".join(lines)


# ─── CLI Test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    from loader import load_nodexl
    from features import FeatureEngineer

    if len(sys.argv) < 2:
        print("Usage: python sentiment.py <file.xlsx|file.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    G, meta = load_nodexl(filepath)
    fe = FeatureEngineer(G)
    sa = SentimentAnalyzer(fe)
    sa.fit()
    print(sa.print_report())
