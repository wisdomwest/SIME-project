"""
disinformation.py — 5-signal composite scoring for disinformation detection.

Algorithm (from SIMElab research methodology):
  1. Retweet amplification anomaly  (weight 0.25)
  2. Temporal regularity            (weight 0.15)
  3. Network position anomaly       (weight 0.30)
  4. Echo chamber index             (weight 0.15)
  5. Follower sparse connectivity   (weight 0.15)

Classification: D(v) < 0.35 clean, 0.35-0.60 suspicious, ≥ 0.60 likely disinfo.

Usage:
    from disinformation import DisinformationAnalyzer
    da = DisinformationAnalyzer(G, fe)
    scores = da.score_all()
    da.print_report()
"""

from typing import Dict, List, Tuple, Optional
import numpy as np

try:
    from .features import FeatureEngineer, DEGREE, BETWEENNESS, CLUSTERING, RECIPROCITY
except ImportError:
    from features import FeatureEngineer, DEGREE, BETWEENNESS, CLUSTERING, RECIPROCITY


class DisinformationAnalyzer:
    """
    5-signal composite disinformation score per node.

    No text content needed — purely structural and behavioural signals.
    """

    RISK_LEVELS = {
        "clean": (0.0, 0.35),
        "suspicious": (0.35, 0.60),
        "likely_disinfo": (0.60, 1.0),
    }

    RISK_COLORS = {
        "clean": "#4CAF50",
        "suspicious": "#FF9800",
        "likely_disinfo": "#F44336",
    }

    def __init__(self, G, fe: FeatureEngineer):
        self.G = G
        self.fe = fe
        self.fe.build_matrix()
        self.nodes = fe.get_nodes()

        # Results
        self.scores: Dict[str, float] = {}
        self.signals: Dict[str, Dict[str, float]] = {}  # node → {signal_name: value}
        self.risk_labels: Dict[str, str] = {}

    def _retweet_amplification(self) -> Dict[str, float]:
        """
        A1: Retweet amplification anomaly.
        (retweets + 1) / (followers + 1), capped at 95th percentile.
        High = disproportionate retweet volume relative to follower count.
        """
        ratios = {}
        for node in self.G.nodes():
            attrs = self.G.nodes[node]
            followers = attrs.get("followers", 0) or 0
            # Out-degree as proxy for retweets this account receives (in-degree)
            in_deg = self.G.in_degree(node) if self.G.is_directed() else self.G.degree(node)
            ratios[node] = (in_deg + 1) / (followers + 1)

        if not ratios:
            return {}

        vals = list(ratios.values())
        cap = float(np.percentile(vals, 95)) if len(vals) > 1 else max(vals)
        # Normalize to [0, 1]
        return {n: min(v / cap, 1.0) for n, v in ratios.items()}

    def _temporal_regularity(self) -> Dict[str, float]:
        """
        A2: Temporal regularity — 1 - σ(Δt)/μ(Δt).
        Bots post at regular intervals; humans post irregularly.
        Uses edge timestamps if available. Falls back to 0.5 if no temporal data.
        """
        scores = {}
        for node in self.G.nodes():
            # Check for timestamp data on edges
            timestamps = []
            for _, _, data in self.G.out_edges(node, data=True):
                ts = data.get("Date", data.get("date", data.get("timestamp", None)))
                if ts is not None:
                    try:
                        timestamps.append(float(ts))
                    except (ValueError, TypeError):
                        pass

            if len(timestamps) >= 3:
                timestamps = sorted(timestamps)
                diffs = np.diff(timestamps)
                if diffs.std() > 0 and diffs.mean() > 0:
                    cv = diffs.std() / diffs.mean()  # coefficient of variation
                    scores[node] = 1.0 - min(cv, 1.0)  # 0 = irregular, 1 = clockwork
                else:
                    scores[node] = 0.5
            else:
                scores[node] = 0.5  # no temporal data → neutral

        return scores

    def _network_position_anomaly(self) -> Dict[str, float]:
        """
        A3: Network position anomaly.
        A3(v) = (out_deg + 1) / (out_deg + C_B + 1)
        High out-degree + low betweenness = broadcast-only accounts (suspicious).
        """
        scores = {}
        fe = self.fe
        out_deg = fe._matrix[:, DEGREE]  # already normalized
        betw = fe._matrix[:, BETWEENNESS]

        for i, node in enumerate(self.nodes):
            # Use raw degree for better signal
            if self.G.is_directed():
                raw_out = self.G.out_degree(node)
            else:
                raw_out = self.G.degree(node)
            raw_betw = betw[i] * (fe.n * fe.n) / 2  # un-normalize approximately

            scores[node] = (raw_out + 1) / (raw_out + raw_betw + 1)

        return scores

    def _echo_chamber_index(self) -> Dict[str, float]:
        """
        A4: Echo chamber index — fraction of edges within the same community.
        High = user only interacts within their own cluster.
        Requires community detection (Louvain).
        """
        # Import community detection here to avoid circular imports
        from networkx.algorithms.community import louvain_communities

        # Convert to undirected for community detection
        G_undirected = self.G.to_undirected()
        try:
            communities = louvain_communities(G_undirected, seed=42)
        except Exception:
            # Fallback: everyone in one community
            communities = [set(self.G.nodes())]

        # Build node → community map
        node_community = {}
        for cid, community in enumerate(communities):
            for node in community:
                node_community[node] = cid

        scores = {}
        for node in self.G.nodes():
            node_com = node_community.get(node, 0)
            total_deg = self.G.degree(node) if not self.G.is_directed() else \
                        self.G.in_degree(node) + self.G.out_degree(node)

            if total_deg == 0:
                scores[node] = 0.0
                continue

            # Count edges to same community
            intra = sum(1 for neighbor in self.G.neighbors(node)
                        if node_community.get(neighbor, -1) == node_com)
            scores[node] = intra / total_deg

        return scores

    def _follower_sparse_connectivity(self) -> Dict[str, float]:
        """
        A5: Follower sparse connectivity = 1 - CC_ego.
        Low clustering coefficient in ego network → sparse follower graph →
        possible bot followers or purchased followers.
        """
        scores = {}
        cc = self.fe._matrix[:, CLUSTERING]
        for i, node in enumerate(self.nodes):
            scores[node] = 1.0 - cc[i]

        return scores

    def score_all(self) -> Dict[str, float]:
        """
        Compute the composite disinformation score D(v) for all nodes.

        Returns:
            Dict[node → float] with scores in [0, 1]
        """
        # Weights from methodology
        weights = {
            "retweet_amplification": 0.25,
            "temporal_regularity": 0.15,
            "network_position_anomaly": 0.30,
            "echo_chamber_index": 0.15,
            "follower_sparse_connectivity": 0.15,
        }

        # Compute all signals
        a1 = self._retweet_amplification()
        a2 = self._temporal_regularity()
        a3 = self._network_position_anomaly()
        a4 = self._echo_chamber_index()
        a5 = self._follower_sparse_connectivity()

        # Composite score
        self.scores = {}
        self.signals = {}
        for node in self.nodes:
            signals = {
                "retweet_amplification": a1.get(node, 0.5),
                "temporal_regularity": a2.get(node, 0.5),
                "network_position_anomaly": a3.get(node, 0.5),
                "echo_chamber_index": a4.get(node, 0.5),
                "follower_sparse_connectivity": a5.get(node, 0.5),
            }
            self.signals[node] = signals
            self.scores[node] = sum(weights[k] * v for k, v in signals.items())

        # Classify
        self.risk_labels = {}
        for node, score in self.scores.items():
            if score < 0.35:
                self.risk_labels[node] = "clean"
            elif score < 0.60:
                self.risk_labels[node] = "suspicious"
            else:
                self.risk_labels[node] = "likely_disinfo"

        return self.scores

    def get_score(self, node: str) -> float:
        """Get disinformation score for a node."""
        if not self.scores:
            self.score_all()
        return self.scores.get(node, 0.0)

    def get_risk_label(self, node: str) -> str:
        """Get risk classification for a node."""
        if not self.risk_labels:
            self.score_all()
        return self.risk_labels.get(node, "clean")

    def to_dataframe(self):
        """Return DataFrame with disinformation scores and signals."""
        import pandas as pd
        if not self.scores:
            self.score_all()

        rows = []
        for node in self.nodes:
            row = {"node": node, "disinfo_score": self.scores[node],
                   "risk_level": self.risk_labels[node]}
            row.update(self.signals[node])
            rows.append(row)
        return pd.DataFrame(rows).set_index("node")

    def print_report(self) -> str:
        """Human-readable disinformation analysis report."""
        if not self.scores:
            self.score_all()

        lines = []
        lines.append("Disinformation Analysis (5-Signal Composite)")
        lines.append("=" * 60)

        # Distribution
        counts = {"clean": 0, "suspicious": 0, "likely_disinfo": 0}
        for label in self.risk_labels.values():
            counts[label] += 1

        n = len(self.nodes)
        for label in ["clean", "suspicious", "likely_disinfo"]:
            c = counts[label]
            lines.append(f"  {label}: {c} nodes ({c/max(n,1)*100:.1f}%)")

        # Stats
        scores_arr = np.array(list(self.scores.values()))
        lines.append(f"\nScore distribution:")
        lines.append(f"  Mean: {scores_arr.mean():.4f}  Std: {scores_arr.std():.4f}")
        lines.append(f"  Min: {scores_arr.min():.4f}  Max: {scores_arr.max():.4f}")

        # Top suspicious
        lines.append(f"\nTop 10 Most Suspicious:")
        top10 = sorted(self.scores.items(), key=lambda x: x[1], reverse=True)[:10]
        for node, score in top10:
            signals = self.signals[node]
            name = self.G.nodes[node].get("display_name", "")
            lines.append(f"  @{node}  D={score:.4f}  A1={signals['retweet_amplification']:.2f}  "
                         f"A3={signals['network_position_anomaly']:.2f}  "
                         f"A4={signals['echo_chamber_index']:.2f}  '{name}'")

        return "\n".join(lines)


# ─── CLI Test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    from loader import load_nodexl
    from features import FeatureEngineer

    if len(sys.argv) < 2:
        print("Usage: python disinformation.py <file.xlsx|file.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    G, meta = load_nodexl(filepath)
    fe = FeatureEngineer(G)
    da = DisinformationAnalyzer(G, fe)
    da.score_all()
    print(da.print_report())
