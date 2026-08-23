import osmnx as ox, networkx as nx

ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]

BBOX = (101.54, 3.06, 101.69, 3.13)

G_road = ox.graph_from_bbox(bbox=BBOX, network_type="drive", simplify=False)
G_moto = ox.graph_from_bbox(
    bbox=BBOX,
    custom_filter='["motorcycle"~"designated|yes"]',
    retain_all=True,
    simplify=False,
)
G = nx.compose(G_road, G_moto)

missing = sum(1 for u, v, d in G.edges(data=True) if "length" not in d or d["length"] is None)
moto = [(u, v, d) for u, v, d in G.edges(data=True)
        if str(d.get("motorcycle", "")) in ("designated", "yes")]
flood = [(u, v, d) for u, v, d in G.edges(data=True)
         if str(d.get("flood_prone", "")).lower() == "yes"
         or "flood" in str(d.get("note", "")).lower()]

print("edges missing length:", missing)
print("MOTO EDGES IN COMPOSED GRAPH:", len(moto))
print("moto edges missing length:", sum(1 for _, _, d in moto if "length" not in d or d["length"] is None))
print("FLOOD EDGES IN COMPOSED GRAPH:", len(flood))