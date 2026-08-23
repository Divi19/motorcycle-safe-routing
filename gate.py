import osmnx as ox, networkx as nx

# OSMnx strips any way tag not on its default whitelist.
# Without this, motorcycle/flood_prone never reach the graph.
ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]

BBOX = (101.54, 3.06, 101.69, 3.13)

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

comps = sorted(nx.weakly_connected_components(G_moto), key=len, reverse=True)
print("MOTO NODES:", G_moto.number_of_nodes())
print("MOTO COMPONENTS:", len(comps), "| LARGEST:", len(comps[0]))

orig = ox.nearest_nodes(G_road, 101.5557, 3.0743)
dest = ox.nearest_nodes(G_road, 101.6785, 3.1144)

print("ROAD-ONLY PATH:", nx.has_path(G_road, orig, dest))
print("COMPOSED PATH :", nx.has_path(G, orig, dest))

rc = sorted(nx.weakly_connected_components(G_road), key=len, reverse=True)
print("ROAD COMPONENTS:", len(rc), "| LARGEST:", len(rc[0]), "| TOTAL:", G_road.number_of_nodes())

shared = set(G_road.nodes) & set(G_moto.nodes)
print("SHARED NODES:", len(shared))

route = nx.shortest_path(G, orig, dest, weight="length")
moto_edges = 0
for u, v in zip(route[:-1], route[1:]):
    d = G.get_edge_data(u, v)
    if d and any(str(e.get("motorcycle", "")) in ("designated", "yes") for e in d.values()):
        moto_edges += 1
print("MOTO EDGES ON SHORTEST PATH:", moto_edges, "of", len(route) - 1)