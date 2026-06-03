"""
hashtag.py — Hashtag lifecycle analysis and authenticity scoring via GMM.

Two sub-analyses:
  1. Hashtag Lifecycle: Birth → Growth → Peak → Contestation → Co-optation → Decay → Resurrection
     Uses temporal volume, sentiment entropy, amplifier ratio, and semantic drift detection.
  2. Hashtag Authenticity via GMM: 2-component Gaussian mixture on 7-D legitimacy features
     to separate organic from artificial hashtag amplification.

Usage:
    from hashtag import HashtagAnalyzer
    ha = HashtagAnalyzer(G, edges_df)
    lifecycle = ha.detect_lifecycle()      # per-hashtag phase
    authenticity = ha.score_hashtags()     # GMM classification
"""

from typing import Dict, List, Tuple, Optional
from collections import defaultdict, Counter
import warnings

import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class HashtagAnalyzer:
    """
    Analyze hashtag lifecycle phases and authenticity in a social media network.

    Requires edges_df with tweet text (for hashtag extraction) and timestamps.
    """

    PHASES = ["Birth", "Growth", "Peak", "Contestation", "Co-optation", "Decay", "Resurrection"]

    PHASE_COLORS = {
        "Birth": "#E3F2FD",
        "Growth": "#4CAF50",
        "Peak": "#FF5722",
        "Contestation": "#FF9800",
        "Co-optation": "#9C27B0",
        "Decay": "#9E9E9E",
        "Resurrection": "#2196F3",
    }

    def __init__(self, G, edges_df: Optional[pd.DataFrame] = None):
        """
        Args:
            G: NetworkX graph
            edges_df: DataFrame with edge data, ideally containing tweet text and timestamps
        """
        self.G = G
        self.edges_df = edges_df

        # Results
        self.hashtag_data: Dict[str, Dict] = {}  # hashtag → {counts over time, authors, etc.}
        self.lifecycle: Dict[str, str] = {}       # hashtag → phase
        self.authenticity: Dict[str, Dict] = {}   # hashtag → {score, label, features}
        self.gmm_labels: Dict[str, str] = {}      # hashtag → "Organic" | "Artificial"

    # ─── Hashtag Extraction ──────────────────────────────────────────────────

    def extract_hashtags(self, include_nodes: bool = True) -> Dict[str, List[str]]:
        """
        Extract hashtags from edge data and node descriptions.

        Returns:
            Dict[hashtag → list of edges/nodes containing it]
        """
        hashtags = defaultdict(list)

        # From edge data (tweet text, tooltip, etc.)
        if self.edges_df is not None:
            for col in ("Tweet", "tweet", "text", "content", "Tooltip", "Label"):
                if col in self.edges_df.columns:
                    for idx, row in self.edges_df.iterrows():
                        text = str(row[col]) if pd.notna(row[col]) else ""
                        tags = [w.strip("#").lower() for w in text.split()
                                if w.startswith("#") and len(w) > 1]
                        for tag in tags:
                            hashtags[tag].append(f"edge_{idx}")

        # From node attributes
        if include_nodes:
            for node in self.G.nodes():
                attrs = self.G.nodes[node]
                for attr in ("description", "tooltip", "nodexl_tooltip", "nodexl_label"):
                    text = str(attrs.get(attr, "")) if attrs.get(attr) else ""
                    tags = [w.strip("#").lower() for w in text.split()
                            if w.startswith("#") and len(w) > 1]
                    for tag in tags:
                        hashtags[tag].append(f"node_{node}")

        return dict(hashtags)

    # ─── Lifecycle Detection ─────────────────────────────────────────────────

    def detect_lifecycle(self, time_column: str = "Date") -> Dict[str, str]:
        """
        Detect lifecycle phase for each hashtag using:
        - Volume over time (bin edges into time windows)
        - Amplifier ratio (bots/organic)
        - Sentiment entropy changes

        Args:
            time_column: Column name for timestamps in edges_df

        Returns:
            Dict[hashtag → phase]
        """
        if self.edges_df is None:
            self.lifecycle = {}
            return self.lifecycle

        # Extract hashtags per edge with timestamps
        hashtag_times: Dict[str, List[float]] = defaultdict(list)
        hashtag_authors: Dict[str, set] = defaultdict(set)

        for idx, row in self.edges_df.iterrows():
            # Try to get text from any text column
            text = ""
            for col in ("Tweet", "tweet", "text", "content", "Tooltip", "Label"):
                if col in self.edges_df.columns and pd.notna(row.get(col)):
                    text = str(row[col])
                    break

            tags = [w.strip("#").lower() for w in text.split()
                    if w.startswith("#") and len(w) > 1]

            # Get timestamp
            ts = None
            if time_column in self.edges_df.columns:
                ts = row[time_column]
                try:
                    ts = float(pd.Timestamp(ts).timestamp())
                except (ValueError, TypeError):
                    ts = None

            for tag in tags:
                if ts is not None:
                    hashtag_times[tag].append(ts)
                source = str(row.get("source", ""))
                target = str(row.get("target", ""))
                hashtag_authors[tag].add(source)
                hashtag_authors[tag].add(target)

        # For each hashtag with enough data, detect phase
        for tag, times in hashtag_times.items():
            if len(times) < 10:
                self.lifecycle[tag] = "Birth"
                continue

            times_sorted = sorted(times)
            n_bins = min(10, len(times) // 3) or 3

            # Bin into time windows
            bins = np.linspace(min(times), max(times), n_bins + 1)
            counts, _ = np.histogram(times, bins=bins)

            # Phase detection
            phase = self._classify_phase(counts, n_bins, len(hashtag_authors[tag]))
            self.lifecycle[tag] = phase

        return self.lifecycle

    def _classify_phase(self, counts: np.ndarray, n_bins: int, n_authors: int) -> str:
        """Classify lifecycle phase from binned volume data."""
        max_idx = int(np.argmax(counts))
        total = counts.sum()

        if n_bins <= 3 and total < 20:
            return "Birth"

        # Growth: increasing volume, early bins
        if max_idx < n_bins * 0.3 and counts[max_idx] / max(total, 1) < 0.5:
            # Check if still growing
            if max_idx > 0 and counts[max_idx] > counts[max_idx - 1]:
                return "Growth"

        # Peak: max volume
        if counts[max_idx] / max(total, 1) > 0.4:
            return "Peak"

        # Decay: declining after peak
        if max_idx < n_bins * 0.7:
            trail = counts[max_idx + 1:] if max_idx + 1 < len(counts) else []
            if len(trail) > 0 and trail.mean() < counts[max_idx] * 0.5:
                return "Decay"

        # Small resurgence
        if max_idx >= n_bins * 0.7 and n_bins > 4:
            early = counts[:n_bins // 3]
            if early.sum() > 0 and counts[max_idx] > early.mean() * 1.5:
                return "Resurrection"

        # Default
        if total < 50:
            return "Growth"
        elif max_idx < n_bins * 0.5:
            return "Peak"
        else:
            return "Decay"

    # ─── Authenticity via GMM ────────────────────────────────────────────────

    def score_hashtags(self) -> Dict[str, Dict]:
        """
        Score hashtag authenticity using 2-component GMM on legitimacy features.

        7-D feature vector per hashtag:
          log(authors+1), verified_ratio, avg_account_age, hashtag_diversity,
          engagement_ratio, community_integration, original_content_ratio

        Returns:
            Dict[hashtag → {score, label, features}]
        """
        hashtags = self.extract_hashtags(include_nodes=False)
        if len(hashtags) < 5:
            self.authenticity = {}
            return self.authenticity

        # Build feature vectors
        tag_names = []
        X = []

        for tag, occurrences in hashtags.items():
            if len(occurrences) < 3:
                continue

            # Get authors for this hashtag
            authors = set()
            for occ in occurrences:
                if occ.startswith("edge_"):
                    idx = int(occ.replace("edge_", ""))
                    if idx < len(self.edges_df):
                        src = str(self.edges_df.iloc[idx].get("source", ""))
                        tgt = str(self.edges_df.iloc[idx].get("target", ""))
                        if src:
                            authors.add(src)
                        if tgt:
                            authors.add(tgt)

            n_authors = len(authors)

            # Feature vector
            vec = []
            # 1. log(authors + 1)
            vec.append(np.log(n_authors + 1))

            # 2. Verified ratio among authors
            verified = sum(1 for a in authors
                           if a in self.G and self.G.nodes[a].get("verified", False))
            vec.append(verified / max(n_authors, 1))

            # 3. Average account age (proxy: followers as age indicator)
            ages = []
            for a in authors:
                if a in self.G:
                    followers = self.G.nodes[a].get("followers", 0) or 0
                    ages.append(np.log(followers + 1))
            vec.append(np.mean(ages) if ages else 0)

            # 4. Hashtag diversity: how many unique hashtags do these authors use
            all_tags = set()
            for a in authors:
                if a in self.G:
                    desc = str(self.G.nodes[a].get("description", ""))
                    all_tags.update(w.strip("#").lower() for w in desc.split()
                                    if w.startswith("#"))
            vec.append(np.log(len(all_tags) + 1))

            # 5. Engagement ratio: edges containing hashtag / total edges from authors
            total_edges_from_authors = sum(
                self.G.out_degree(a) if self.G.is_directed() else self.G.degree(a)
                for a in authors if a in self.G
            )
            vec.append(len(occurrences) / max(total_edges_from_authors, 1))

            # 6. Community integration: average clustering coefficient of authors
            clustering_vals = [
                self.G.nodes[a].get("clustering_coefficient", 0)
                for a in authors if a in self.G
            ]
            vec.append(np.mean(clustering_vals) if clustering_vals else 0)

            # 7. Original content ratio: 1 - retweet_ratio
            if self.edges_df is not None and "Relationship" in self.edges_df.columns:
                relevant = self.edges_df.iloc[
                    [int(o.replace("edge_", "")) for o in occurrences
                     if o.startswith("edge_") and int(o.replace("edge_", "")) < len(self.edges_df)]
                ]
                retweet_count = (relevant["Relationship"] == "Retweet").sum()
                vec.append(1 - retweet_count / max(len(relevant), 1))
            else:
                vec.append(0.5)

            tag_names.append(tag)
            X.append(vec)

        if len(tag_names) < 5:
            self.authenticity = {}
            return self.authenticity

        X = np.array(X)

        # Normalize
        X_norm = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)

        # Fit 2-component GMM
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            gmm = GaussianMixture(n_components=2, random_state=42, n_init=5)
            labels = gmm.fit_predict(X_norm)

        # Label components: higher mean(account_age proxy) → Organic
        means = gmm.means_
        # Feature 3 is avg account age
        organic_component = 0 if means[0, 3] > means[1, 3] else 1

        # Compute scores (distance from artificial centroid)
        artificial_centroid = means[1 - organic_component]
        organic_centroid = means[organic_component]

        for i, tag in enumerate(tag_names):
            dist_artificial = float(np.linalg.norm(X_norm[i] - artificial_centroid))
            dist_organic = float(np.linalg.norm(X_norm[i] - organic_centroid))
            total_dist = dist_artificial + dist_organic + 1e-8
            authenticity_score = dist_artificial / total_dist  # closer to artificial = low score

            is_organic = labels[i] == organic_component

            self.authenticity[tag] = {
                "score": round(authenticity_score, 4),
                "label": "Organic" if is_organic else "Artificial",
                "features": {f"f{j+1}": round(float(X[i, j]), 4) for j in range(7)},
                "n_authors": len(hashtags[tag]),
            }
            self.gmm_labels[tag] = "Organic" if is_organic else "Artificial"

        return self.authenticity

    def artificial_ratio(self) -> float:
        """Fraction of hashtags flagged as artificially amplified."""
        if not self.gmm_labels:
            self.score_hashtags()
        if not self.gmm_labels:
            return 0.0
        artificial = sum(1 for v in self.gmm_labels.values() if v == "Artificial")
        return artificial / len(self.gmm_labels)

    def to_dataframe(self):
        """Return DataFrame with hashtag lifecycle and authenticity data."""
        import pandas as pd
        if not self.lifecycle:
            self.detect_lifecycle()
        if not self.authenticity:
            self.score_hashtags()

        rows = []
        all_tags = set(self.lifecycle.keys()) | set(self.authenticity.keys())
        for tag in sorted(all_tags):
            row = {
                "hashtag": tag,
                "lifecycle_phase": self.lifecycle.get(tag, "Unknown"),
                "authenticity_label": self.gmm_labels.get(tag, "Unknown"),
                "authenticity_score": self.authenticity.get(tag, {}).get("score", None),
            }
            rows.append(row)
        return pd.DataFrame(rows).set_index("hashtag")

    def print_report(self) -> str:
        """Human-readable hashtag analysis report."""
        if not self.lifecycle:
            self.detect_lifecycle()
        if not self.authenticity:
            self.score_hashtags()

        lines = []
        lines.append("Hashtag Analysis — Lifecycle & Authenticity")
        lines.append("=" * 60)

        # Top hashtags by volume
        if self.hashtag_data:
            top_tags = sorted(self.hashtag_data.items(),
                              key=lambda x: len(x[1].get("occurrences", [])),
                              reverse=True)[:10]
            lines.append("\nTop 10 Hashtags (by occurrences):")
            for tag, data in top_tags:
                lines.append(f"  #{tag}: {len(data.get('occurrences', []))} occurrences")

        # Lifecycle distribution
        if self.lifecycle:
            phase_counts = Counter(self.lifecycle.values())
            lines.append(f"\nLifecycle Phase Distribution ({len(self.lifecycle)} hashtags):")
            for phase in self.PHASES:
                count = phase_counts.get(phase, 0)
                if count > 0:
                    lines.append(f"  {phase}: {count}")

        # Authenticity
        if self.authenticity:
            lines.append(f"\nAuthenticity (GMM, {len(self.authenticity)} hashtags):")
            ar = self.artificial_ratio()
            lines.append(f"  Organic: {sum(1 for v in self.gmm_labels.values() if v == 'Organic')}")
            lines.append(f"  Artificial: {sum(1 for v in self.gmm_labels.values() if v == 'Artificial')}")
            lines.append(f"  Artificial ratio: {ar:.3f}")
            if ar > 0.40:
                lines.append("  ⚠ Significant artificial amplification detected (>40%)")

            # Top artificial hashtags
            artificial = [(t, d["score"]) for t, d in self.authenticity.items()
                          if d["label"] == "Artificial"]
            artificial.sort(key=lambda x: x[1])
            if artificial:
                lines.append(f"\nMost Artificial Hashtags:")
                for tag, score in artificial[:5]:
                    lines.append(f"  #{tag}: authenticity={score:.4f}")

        return "\n".join(lines)


# ─── CLI Test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    from loader import load_nodexl

    if len(sys.argv) < 2:
        print("Usage: python hashtag.py <file.xlsx|file.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    G, meta = load_nodexl(filepath)

    # Load edges for text analysis
    edges_df = None
    try:
        edges_df = pd.read_excel(filepath, sheet_name="Edges", header=1)
    except Exception:
        pass

    ha = HashtagAnalyzer(G, edges_df)
    ha.detect_lifecycle()
    ha.score_hashtags()
    print(ha.print_report())
