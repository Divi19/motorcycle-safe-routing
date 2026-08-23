"""
Build the Klang Valley routing graph once and pickle it to build/graph.pkl.

The API server (build/api.py) loads this pickle at startup instead of
re-downloading and re-annotating the graph on every request.

Run:  python build/build_graph_cache.py
"""

import os
import pickle
import sys
import time

import osmnx as ox
import networkx as nx

# Allow `from weights import ...` when run as `python build/build_graph_cache.py`.
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from weights import risk_multiplier, risk_class  # noqa: E402

# OSMnx strips non-whitelisted way tags by default. Without this, motorcycle
# and flood_prone never reach the graph, so moto lanes and flood segments
# are invisible to the router. Must be set BEFORE any graph_from_bbox call.
ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]

# Matches the bbox guard in api.py and app.js. Wide enough to include
# central KL (KL Sentral at 3.134, 101.686) without over-downloading.
BBOX = (101.50, 3.00, 101.75, 3.20)

PICKLE_PATH = os.path.join(HERE, "graph.pkl")


def build_graph():
    """Compose drive + motorcycle graphs, drop non-roads, annotate edges."""
    print("downloading road graph...")
    G_road = ox.graph_from_bbox(bbox=BBOX, network_type="drive", simplify=False)

    print("downloading motorcycle lane graph...")
    G_moto = ox.graph_from_bbox(
        bbox=BBOX,
        custom_filter='["motorcycle"~"designated|yes"]',
        retain_all=True,
        simplify=False,
    )

    G = nx.compose(G_road, G_moto)

    # Drop edges that are not actually roads (shelters, parking roofs, etc.).
    to_remove = []
    for u, v, k, d in G.edges(keys=True, data=True):
        if d.get("amenity") or d.get("building"):
            to_remove.append((u, v, k))
    if to_remove:
        G.remove_edges_from(to_remove)
        print(f"dropped {len(to_remove)} non-road edges (amenity/building)")

    # Precompute risk_weight (day + night) and risk_class on every edge.
    # The API picks risk_weight_day or risk_weight_night at request time.
    print("annotating edges with risk_weight_day, risk_weight_night, risk_class...")
    for _, _, d in G.edges(data=True):
        length = float(d.get("length", 0.0))
        d["risk_weight_day"] = length * risk_multiplier(d, night=False)
        d["risk_weight_night"] = length * risk_multiplier(d, night=True)
        d["risk_class"] = risk_class(d)

    return G, G_road


def main():
    t0 = time.time()
    G, G_road = build_graph()
    build_secs = time.time() - t0

    nodes = G.number_of_nodes()
    edges = G.number_of_edges()
    print(f"graph: {nodes} nodes, {edges} edges")

    t1 = time.time()
    # Pickle both the composed graph (for routing) and the road-only graph
    # (for endpoint snapping, matching export_routes.py).
    with open(PICKLE_PATH, "wb") as f:
        pickle.dump({"G": G, "G_road": G_road}, f, protocol=pickle.HIGHEST_PROTOCOL)
    pickle_secs = time.time() - t1

    size_mb = os.path.getsize(PICKLE_PATH) / (1024 * 1024)
    print(f"wrote {PICKLE_PATH} ({size_mb:.1f} MB) in {pickle_secs:.1f}s")
    print(f"graph build time: {build_secs:.1f}s")
    print(f"NODES: {nodes}")
    print(f"EDGES: {edges}")
    print(f"PICKLE_MB: {size_mb:.1f}")


if __name__ == "__main__":
    main()
