"""
debug_stats.py — Run this manually to compare Python backend stats vs UI stats.
Usage:  cd /home/west/sime-lab-usiu/SIME-project
        /home/west/sime-lab-usiu/.venv/bin/python3 debug_stats.py
"""
import sys
sys.path.insert(0, 'python')

from simelab.loader import load_nodexl
from simelab.features import FeatureEngineer
from simelab.sentiment import SentimentAnalyzer

filepath = "/home/west/sime-lab-usiu/RejectFinanceBill2024.xlsx"

print("Loading graph...")
G, meta = load_nodexl(filepath)
gs = meta.get("graph_stats", {})

print("\n=== GRAPH STATS (Python backend) ===")
print(f"  Nodes:               {G.number_of_nodes()}")
print(f"  Edges:               {G.number_of_edges()}")
print(f"  Is directed:         {G.is_directed()}")
print(f"  Density:             {gs.get('density')}")
print(f"  Conn. components:    {gs.get('connected_components')}")
print(f"  Reciprocity:         {gs.get('reciprocity')}")

print("\nRunning sentiment analysis...")
fe = FeatureEngineer(G)
fe.build_matrix()
sa = SentimentAnalyzer(fe)
sa.fit()

# SentimentAnalyzer uses cluster_ids and label_map internally
print("\n=== SENTIMENT (Python k-means) ===")
# Print available attributes
attrs = [a for a in dir(sa) if not a.startswith('_')]
print(f"  Available attrs: {attrs}")

# Try to get cluster counts
try:
    import numpy as np
    ids = sa.cluster_ids
    unique, counts = np.unique(ids, return_counts=True)
    label_map = getattr(sa, 'label_map', {0: 'Neg', 1: 'Neu', 2: 'Pos'})
    total = len(ids)
    print(f"  Total labeled: {total}")
    for uid, cnt in zip(unique, counts):
        label = label_map.get(uid, f'cluster_{uid}')
        print(f"  {label}: {cnt}  ({100*cnt/total:.1f}%)")
except Exception as e:
    print(f"  Error: {e}")

try:
    print(f"  Silhouette:          {sa.silhouette}")
except: pass
try:
    print(f"  Polarization:        {sa.polarization_index}")
except: pass
try:
    print(f"  Centroid distance:   {sa.centroid_distance}")
except: pass

print("\n=== DEGREE SAMPLE (top 10 by total degree) ===")
top = sorted(G.degree(), key=lambda x: x[1], reverse=True)[:10]
for node, deg in top:
    print(f"  {node[:35]:35s}  deg={deg}  in={G.in_degree(node)}  out={G.out_degree(node)}")
