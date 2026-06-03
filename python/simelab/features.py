"""
features.py — Build 9-dimensional feature vectors for every node in the graph.

Computation strategy:
1. Try to read pre-computed NodeXL metrics from node attributes (if dataset had Graph Metrics run)
2. For any missing metric, compute it using networkx algorithms
3. Normalize and return a feature matrix + per-node dict

9 Feature Dimensions:
  1. degree_centrality       — normalized by n-1
  2. betweenness_centrality  — normalized by (n-1)(n-2)/2
  3. closeness_centrality    — Wasserman-Faust normalized
  4. eigenvector_centrality  — power iteration
  5. pagerank                — iterative, alpha=0.85
  6. clustering_coefficient  — Watts-Strogatz local clustering
  7. reciprocity             — edge-level (in/out ratio and neighbourhood overlap)
  8. follower_ratio          — followers / (followers + following), proxy for authority
  9. influence_score         — composite: 0.3*deg + 0.25*pr + 0.2*betw + 0.15*eig + 0.1*close

Usage:
    from features import FeatureEngineer
    fe = FeatureEngineer(G)
    vectors = fe.build_matrix()       # np.array (n_nodes, 9)
    node_vec = fe.get_node("user")    # np.array (9,)
    fe.print_summary()                # human-readable overview
"""

from typing import Dict, Optional, Tuple, List
import warnings

import networkx as nx
import numpy as np

# ─── Feature dimension indices ──────────────────────────────────────────────
DEGREE = 0
BETWEENNESS = 1
CLOSENESS = 2
EIGENVECTOR = 3
PAGERANK = 4
CLUSTERING = 5
RECIPROCITY = 6
FOLLOWER_RATIO = 7
INFLUENCE = 8

FEATURE_NAMES = [
    "degree_centrality",
    "betweenness_centrality",
    "closeness_centrality",
    "eigenvector_centrality",
    "pagerank",
    "clustering_coefficient",
    "reciprocity",
    "follower_ratio",
    "influence_score",
]

FEATURE_LABELS = [
    "Degree Centrality",
    "Betweenness Centrality",
    "Closeness Centrality",
    "Eigenvector Centrality",
    "PageRank",
    "Clustering Coefficient",
    "Reciprocity",
    "Follower Ratio",
    "Influence Score",
]


class FeatureEngineer:
    """
    Build and manage 9-D feature vectors for all nodes in a NetworkX graph.

    Handles both directed and undirected graphs. For undirected graphs,
    reciprocity is set to 0 and degree is total degree.
    """

    def __init__(self, G: nx.Graph):
        self.G = G
        self.is_directed = G.is_directed()
        self.n = G.number_of_nodes()

        # Ordered node list (deterministic: sorted by username)
        self._nodes = sorted(G.nodes())

        # Feature matrix: (n_nodes, 9), initialized to NaN
        self._matrix: Optional[np.ndarray] = None

        # Node → index mapping
        self._node_to_idx: Dict[str, int] = {node: i for i, node in enumerate(self._nodes)}

    # ─── Metric Computation ──────────────────────────────────────────────────

    def _compute_degree(self) -> np.ndarray:
        """Normalized degree centrality (0-1)."""
        if self.is_directed:
            deg_dict = nx.degree_centrality(self.G)
        else:
            deg_dict = nx.degree_centrality(self.G)
        return np.array([deg_dict.get(node, 0.0) for node in self._nodes])

    def _compute_betweenness(self) -> np.ndarray:
        """Normalized betweenness centrality (0-1). Uses k=min(n, 500) sampling for large graphs."""
        k = min(self.n, 500) if self.n > 500 else None
        bc_dict = nx.betweenness_centrality(self.G, k=k, normalized=True)
        return np.array([bc_dict.get(node, 0.0) for node in self._nodes])

    def _compute_closeness(self) -> np.ndarray:
        """Closeness centrality (Wasserman-Faust normalized)."""
        cc_dict = nx.closeness_centrality(self.G, wf_improved=True)
        return np.array([cc_dict.get(node, 0.0) for node in self._nodes])

    def _compute_eigenvector(self) -> np.ndarray:
        """Eigenvector centrality. Falls back to zeros on convergence failure."""
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                ec_dict = nx.eigenvector_centrality_numpy(self.G)
        except Exception:
            try:
                ec_dict = nx.eigenvector_centrality(self.G, max_iter=500, tol=1e-4)
            except Exception:
                # Power iteration failed — use degree as fallback
                deg = dict(self.G.degree())
                max_deg = max(deg.values()) if deg else 1
                ec_dict = {n: d / max_deg for n, d in deg.items()}
        return np.array([ec_dict.get(node, 0.0) for node in self._nodes])

    def _compute_pagerank(self) -> np.ndarray:
        """PageRank (alpha=0.85, max 200 iterations)."""
        pr_dict = nx.pagerank(self.G, alpha=0.85, max_iter=200)
        return np.array([pr_dict.get(node, 0.0) for node in self._nodes])

    def _compute_clustering(self) -> np.ndarray:
        """Watts-Strogatz local clustering coefficient."""
        if self.is_directed:
            cc_dict = nx.clustering(self.G.to_undirected())
        else:
            cc_dict = nx.clustering(self.G)
        return np.array([cc_dict.get(node, 0.0) for node in self._nodes])

    def _compute_reciprocity(self) -> np.ndarray:
        """
        Node-level reciprocity proxy.
        For each node: ratio of mutual connections to total connections.
        For undirected graphs: all 0.0 (reciprocity is meaningless).
        """
        if not self.is_directed:
            return np.zeros(self.n)

        reciprocity = np.zeros(self.n)
        for i, node in enumerate(self._nodes):
            in_deg = self.G.in_degree(node)
            out_deg = self.G.out_degree(node)
            total = in_deg + out_deg
            if total == 0:
                reciprocity[i] = 0.0
            else:
                # Count mutual edges: edges where both A→B and B→A exist
                mutual = sum(1 for pred in self.G.predecessors(node)
                             if self.G.has_edge(node, pred))
                reciprocity[i] = (2.0 * mutual) / total if total > 0 else 0.0
        return reciprocity

    def _compute_follower_ratio(self) -> np.ndarray:
        """
        Follower ratio: followers / (followers + following).
        A proxy for authority/influence. 0.5 = balanced, 1.0 = broadcast-only.
        Falls back to degree-based estimate if account data unavailable.
        """
        ratio = np.zeros(self.n)
        for i, node in enumerate(self._nodes):
            attrs = self.G.nodes[node]
            followers = attrs.get("followers", None)
            following = attrs.get("following", None)

            if followers is not None and following is not None:
                denom = followers + following
                ratio[i] = followers / denom if denom > 0 else 0.5
            else:
                # Estimate from network position: out-degree as proxy for following,
                # in-degree as proxy for followers
                if self.is_directed:
                    in_d = self.G.in_degree(node)
                    out_d = self.G.out_degree(node)
                    denom = in_d + out_d
                    ratio[i] = in_d / denom if denom > 0 else 0.5
                else:
                    ratio[i] = 0.5
        return ratio

    def _compute_influence(self, features: np.ndarray) -> np.ndarray:
        """
        Composite influence score: weighted combination of centrality metrics.
        Weights: 0.30*degree + 0.25*pagerank + 0.20*betweenness + 0.15*eigenvector + 0.10*closeness
        """
        return (
            0.30 * features[:, DEGREE]
            + 0.25 * features[:, PAGERANK]
            + 0.20 * features[:, BETWEENNESS]
            + 0.15 * features[:, EIGENVECTOR]
            + 0.10 * features[:, CLOSENESS]
        )

    # ─── Main Build ──────────────────────────────────────────────────────────

    def build_matrix(self, force_recompute: bool = False) -> np.ndarray:
        """
        Build the (n_nodes, 9) feature matrix. Caches result.

        Args:
            force_recompute: If True, recompute even if cached.

        Returns:
            np.ndarray of shape (n_nodes, 9), ordered by sorted node names.
            Column order: degree, betweenness, closeness, eigenvector, pagerank,
                          clustering, reciprocity, follower_ratio, influence.
        """
        if self._matrix is not None and not force_recompute:
            return self._matrix

        self._matrix = np.zeros((self.n, 9))

        # Compute each dimension
        self._matrix[:, DEGREE] = self._compute_degree()
        self._matrix[:, BETWEENNESS] = self._compute_betweenness()
        self._matrix[:, CLOSENESS] = self._compute_closeness()
        self._matrix[:, EIGENVECTOR] = self._compute_eigenvector()
        self._matrix[:, PAGERANK] = self._compute_pagerank()
        self._matrix[:, CLUSTERING] = self._compute_clustering()
        self._matrix[:, RECIPROCITY] = self._compute_reciprocity()
        self._matrix[:, FOLLOWER_RATIO] = self._compute_follower_ratio()

        # Influence is a composite of the others — compute last
        self._matrix[:, INFLUENCE] = self._compute_influence(self._matrix)

        # Clamp any small negatives from floating point
        self._matrix = np.clip(self._matrix, 0.0, None)

        return self._matrix

    # ─── Accessors ───────────────────────────────────────────────────────────

    def get_node(self, node: str) -> Optional[np.ndarray]:
        """Get the 9-D feature vector for a specific node."""
        if self._matrix is None:
            self.build_matrix()
        idx = self._node_to_idx.get(node)
        if idx is None:
            return None
        return self._matrix[idx]

    def get_top(self, dimension: int, k: int = 10) -> List[Tuple[str, float]]:
        """Get top-k nodes by a specific feature dimension."""
        if self._matrix is None:
            self.build_matrix()
        col = self._matrix[:, dimension]
        top_indices = np.argsort(col)[::-1][:k]
        return [(self._nodes[i], float(col[i])) for i in top_indices]

    def get_nodes(self) -> List[str]:
        """Return ordered list of node names."""
        return list(self._nodes)

    def to_dict(self) -> Dict[str, Dict[str, float]]:
        """Convert to {node_name: {feature_name: value}} dict."""
        if self._matrix is None:
            self.build_matrix()
        result = {}
        for i, node in enumerate(self._nodes):
            result[node] = {
                FEATURE_NAMES[j]: float(self._matrix[i, j])
                for j in range(9)
            }
        return result

    def to_dataframe(self):
        """Return a pandas DataFrame with nodes as rows, features as columns."""
        import pandas as pd
        if self._matrix is None:
            self.build_matrix()
        df = pd.DataFrame(self._matrix, index=self._nodes, columns=FEATURE_NAMES)
        df.index.name = "node"
        return df

    # ─── Summary ─────────────────────────────────────────────────────────────

    def print_summary(self) -> str:
        """Human-readable summary of feature statistics."""
        if self._matrix is None:
            self.build_matrix()

        lines = []
        lines.append(f"Feature Matrix: {self.n} nodes × 9 dimensions")
        lines.append("=" * 60)

        for j, (name, label) in enumerate(zip(FEATURE_NAMES, FEATURE_LABELS)):
            col = self._matrix[:, j]
            lines.append(f"\n{label} ({name})")
            lines.append(f"  Mean: {col.mean():.6f}  Std: {col.std():.6f}")
            lines.append(f"  Min:  {col.min():.6f}  Max:  {col.max():.6f}")

            # Top 5
            top5 = self.get_top(j, k=5)
            lines.append(f"  Top 5: {', '.join(f'{n}={v:.4f}' for n, v in top5)}")

        return "\n".join(lines)


# ─── CLI Test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    from loader import load_nodexl

    if len(sys.argv) < 2:
        print("Usage: python features.py <file.xlsx|file.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    print(f"Loading: {filepath}")
    G, meta = load_nodexl(filepath)

    print(f"Building features for {G.number_of_nodes()} nodes...")
    fe = FeatureEngineer(G)
    fe.build_matrix()

    print(fe.print_summary())

    print("\n\n=== Top 10 by Influence Score ===")
    for node, score in fe.get_top(INFLUENCE, k=10):
        display = G.nodes[node].get("display_name", "")
        followers = G.nodes[node].get("followers", "")
        print(f"  @{node}  influence={score:.6f}  followers={followers}  name='{display}'")
