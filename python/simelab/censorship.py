"""
censorship.py - Structural hole analysis for censorship detection.

From SIMElab research methodology:
  1. Compute Betweenness Centrality for all vertices in G_t1
  2. Find vertices in V_t1 \ V_t2 (disappeared accounts)
  3. Structural Impact: SI(v) = C_B(v) · log(deg(v) + 1)
  4. Rank by SI descending
  5. Censorship Vulnerability Index: CVI = 1/λ2(L) · max(C_B(v))

Single-snapshot mode: identify accounts whose removal would fragment the network.
These are structurally critical — their disappearance would indicate censorship.

Usage:
    from censorship import CensorshipAnalyzer
    ca = CensorshipAnalyzer(G)
    critical = ca.find_structural_holes(k=20)
    ca.print_report()
"""

from typing import Dict, List, Tuple, Optional
import warnings

import numpy as np
import networkx as nx
from scipy.sparse.linalg import eigsh


class CensorshipAnalyzer:
    """
    Identify structurally critical accounts — bridges and connectors
    whose removal would fragment the network.
    """

    def __init__(self, G):
        self.G = G
        self.is_directed = G.is_directed()
        self.n = G.number_of_nodes()

        # Pre-compute betweenness (use sampling for large graphs)
        k = min(self.n, 500) if self.n > 500 else None
        self.betweenness: Dict[str, float] = nx.betweenness_centrality(G, k=k, normalized=True)

        # Compute the Fiedler value (λ2 of Laplacian) — slow for large graphs
        self.fiedler_value: Optional[float] = None
        self.cvi: Optional[float] = None

        # Results
        self.structural_holes: List[Tuple[str, float, Dict]] = []

    def _compute_fiedler(self) -> float:
        """Compute the Fiedler value (λ2 of graph Laplacian)."""
        if self.fiedler_value is not None:
            return self.fiedler_value

        try:
            G_undirected = self.G.to_undirected()
            L = nx.laplacian_matrix(G_undirected).astype(float)
            # Get 3 smallest eigenvalues
            eigenvalues = eigsh(L, k=3, which="SM", return_eigenvectors=False, maxiter=500)
            # λ0 ≈ 0, λ1 = algebraic connectivity (Fiedler), λ2 = next
            self.fiedler_value = float(eigenvalues[1]) if len(eigenvalues) > 1 else 0.001
        except Exception:
            self.fiedler_value = 0.001  # fallback: near-fragmentation

        return self.fiedler_value

    def structural_impact(self, node: str) -> float:
        """
        Structural Impact of a node:
        SI(v) = C_B(v) · log(deg(v) + 1)
        """
        cb = self.betweenness.get(node, 0.0)
        if self.is_directed:
            total_deg = self.G.in_degree(node) + self.G.out_degree(node)
        else:
            total_deg = self.G.degree(node)
        return cb * np.log(total_deg + 1)

    def find_structural_holes(self, k: int = 20) -> List[Tuple[str, float, Dict]]:
        """
        Find top-k structurally critical nodes (bridges, connectors).

        Returns:
            List of (node, SI_score, details_dict) sorted by SI descending.
            details includes: betweenness, degree, ego_network_size, component_impact
        """
        impacts = []
        for node in self.G.nodes():
            si = self.structural_impact(node)
            if self.is_directed:
                total_deg = self.G.in_degree(node) + self.G.out_degree(node)
            else:
                total_deg = self.G.degree(node)

            impacts.append({
                "node": node,
                "si_score": si,
                "betweenness": self.betweenness.get(node, 0.0),
                "degree": total_deg,
            })

        # Sort by SI descending
        impacts.sort(key=lambda x: x["si_score"], reverse=True)

        # Test component impact for top candidates
        for item in impacts[:min(k * 2, len(impacts))]:
            node = item["node"]
            # How many components if this node is removed?
            G_copy = self.G.copy()
            G_copy.remove_node(node)
            if G_copy.is_directed():
                n_components = nx.number_weakly_connected_components(G_copy)
            else:
                n_components = nx.number_connected_components(G_copy)

            if G_copy.is_directed():
                original_components = nx.number_weakly_connected_components(self.G)
            else:
                original_components = nx.number_connected_components(self.G)

            item["components_after_removal"] = n_components
            item["component_increase"] = n_components - original_components
            item["is_fragmenting"] = n_components > original_components * 1.1

        # Filter to top k
        self.structural_holes = [
            (item["node"], item["si_score"], item)
            for item in impacts[:k]
        ]

        return self.structural_holes

    def censorship_vulnerability_index(self) -> float:
        """
        CVI = (1 / λ2) · max(C_B(v))
        High CVI = network is both fragile AND has a single-point-of-failure account.
        """
        fiedler = self._compute_fiedler()
        max_cb = max(self.betweenness.values()) if self.betweenness else 0.0
        self.cvi = max_cb / max(fiedler, 1e-8)
        return self.cvi

    def get_critical_nodes(self, threshold: float = 0.1) -> List[str]:
        """
        Get nodes with betweenness above a threshold.
        These are the bridges whose removal is most impactful.
        """
        max_cb = max(self.betweenness.values()) if self.betweenness else 1.0
        return [n for n, cb in self.betweenness.items()
                if cb / max(max_cb, 1e-8) >= threshold]

    def flag_censored_candidates(self, nodes_before: set, nodes_after: set) -> List[Tuple[str, float]]:
        """
        Given two snapshots (nodes_before, nodes_after), identify disappeared
        high-impact nodes — potential censorship targets.

        Args:
            nodes_before: Set of node names in G_t1
            nodes_after: Set of node names in G_t2

        Returns:
            List of (node, SI_score) for disappeared nodes, ranked by SI
        """
        disappeared = nodes_before - nodes_after
        candidates = []
        for node in disappeared:
            si = self.structural_impact(node)
            if si > 0:
                candidates.append((node, si))

        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates

    def to_dataframe(self):
        """Return DataFrame with structural hole analysis."""
        import pandas as pd
        if not self.structural_holes:
            self.find_structural_holes()

        rows = []
        for node, si, details in self.structural_holes:
            row = {
                "node": node,
                "si_score": round(si, 6),
                "betweenness": round(details.get("betweenness", 0), 6),
                "degree": details.get("degree", 0),
                "components_after_removal": details.get("components_after_removal", 1),
                "component_increase": details.get("component_increase", 0),
                "is_fragmenting": details.get("is_fragmenting", False),
            }
            rows.append(row)
        return pd.DataFrame(rows).set_index("node")

    def print_report(self) -> str:
        """Human-readable censorship/structural hole analysis report."""
        if not self.structural_holes:
            self.find_structural_holes()

        lines = []
        lines.append("Censorship & Structural Hole Analysis")
        lines.append("=" * 60)

        # Fiedler value
        fiedler = self._compute_fiedler()
        lines.append(f"\nAlgebraic Connectivity (Fiedler λ2): {fiedler:.6f}")
        if fiedler < 0.01:
            lines.append("  🔴 Network is one edge away from fragmentation")
        elif fiedler < 0.1:
            lines.append("  🟡 Network is loosely connected — fragile")
        else:
            lines.append("  🟢 Network has robust connectivity")

        # CVI
        cvi = self.censorship_vulnerability_index()
        lines.append(f"\nCensorship Vulnerability Index: {cvi:.4f}")
        if cvi > 100:
            lines.append("  🔴 Highly vulnerable — single account removal could fragment network")
        elif cvi > 10:
            lines.append("  🟡 Moderately vulnerable")
        else:
            lines.append("  🟢 Resilient to single-account removal")

        # Top structural holes
        lines.append(f"\nTop 20 Structural Holes (critical bridges):")
        lines.append(f"  {'Node':<25s} {'SI':>10s} {'C_B':>10s} {'Deg':>6s} {'Frag?':>6s}")
        lines.append(f"  {'-'*57}")

        for node, si, details in self.structural_holes[:20]:
            name = self.G.nodes[node].get("display_name", "")[:20]
            lines.append(
                f"  @{node:<24s} {si:10.6f} {details['betweenness']:10.6f} "
                f"{details['degree']:6d} {'YES' if details['is_fragmenting'] else 'no':>6s}"
            )

        # Fragmenting count
        fragmenting = sum(1 for _, _, d in self.structural_holes if d["is_fragmenting"])
        lines.append(f"\n{fragmenting} of top 20 structural holes would fragment the network on removal")

        return "\n".join(lines)


# ─── CLI Test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    from loader import load_nodexl

    if len(sys.argv) < 2:
        print("Usage: python censorship.py <file.xlsx|file.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    G, meta = load_nodexl(filepath)

    ca = CensorshipAnalyzer(G)
    ca.find_structural_holes(k=20)
    ca.censorship_vulnerability_index()
    print(ca.print_report())
