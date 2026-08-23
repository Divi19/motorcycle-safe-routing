"""
Export risk-weighted routes for the demo corridor, day and night.

For each (corridor, time_of_day):
  1. Compose G_road (network_type drive) with G_moto (motorcycle=designated|yes)
     exactly as in gate.py / BUILD_CONTEXT section 5.
  2. Drop edges carrying an `amenity` or `building` tag (per Ticket 1.1 / BUILD_CONTEXT).
  3. For every remaining edge, set edge["risk_weight"] = length_m * risk_multiplier.
  4. Compute two routes with nx.shortest_path:
       - fastest        -> weight = travel_time (falls back to length)
       - lower_exposure -> weight = risk_weight
  5. Walk each route, attach risk_class per edge, merge consecutive edges that
     share the same risk_class into one segment.
  6. Build exposure stats and comparison.reasons from the actual computed
     difference (no hardcoded copy).
  7. Write JSON matching BUILD_CONTEXT section 7 into data/, overwriting fixtures.

Only touches build/export_routes.py and data/.
"""

import json
import os
import sys

import osmnx as ox
import networkx as nx

# Allow `from weights import ...` when run as `python build/export_routes.py`.
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from weights import risk_multiplier, risk_class  # noqa: E402

# OSMnx strips non-whitelisted way tags by default. Without this, motorcycle
# and flood_prone never reach the graph, so moto lanes and flood segments
# are invisible to the router.
ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]

BBOX = (101.54, 3.06, 101.69, 3.13)

CORRIDORS = [
    {
        "id": "shah_alam_midvalley",
        "label": "Shah Alam \u2192 Mid Valley",
        "origin": {"lat": 3.0743, "lon": 101.5557, "name": "Batu Tiga"},
        "destination": {"lat": 3.1144, "lon": 101.6785, "name": "Seputeh"},
    },
]

DATA_DIR = os.path.join(os.path.dirname(HERE), "data")

HIGH_RISK_CLASSES = {"high", "flood"}


def load_graph():
    """Compose the drive graph with the motorcycle-lane graph, drop non-roads."""
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

    return G, G_road


def annotate_edges(G, night):
    """Attach risk_weight and risk_class to every edge in place."""
    for _, _, d in G.edges(data=True):
        d["risk_weight"] = d.get("length", 0.0) * risk_multiplier(d, night=night)
        d["risk_class"] = risk_class(d)


def fastest_weight_key(G):
    """Use travel_time if every edge has it; otherwise fall back to length."""
    has_tt = all("travel_time" in d for _, _, d in G.edges(data=True))
    return "travel_time" if has_tt else "length"


def edge_attrs_for_segment(d):
    """Pick a representative attrs dict for a merged segment (first edge wins)."""
    return {
        "highway": d.get("highway", ""),
        "motorcycle": d.get("motorcycle", ""),
        "flood_prone": d.get("flood_prone", ""),
        "note": d.get("note", ""),
    }


def route_to_segments(G, route):
    """
    Walk the route node list, emit one segment per run of consecutive edges
    that share the same risk_class. Coords are [lat, lon] in Leaflet order.
    """
    segments = []
    current = None

    for u, v in zip(route[:-1], route[1:]):
        d = pick_edge(G, u, v)
        if d is None:
            continue

        rclass = d["risk_class"]
        length_m = float(d.get("length", 0.0))
        u_xy = (float(G.nodes[u]["y"]), float(G.nodes[u]["x"]))
        v_xy = (float(G.nodes[v]["y"]), float(G.nodes[v]["x"]))

        if current and current["risk_class"] == rclass:
            # extend: replace trailing coord with the new endpoint
            current["coords"].append(v_xy)
            current["length_m"] += length_m
            current["_edge_count"] += 1
        else:
            if current is not None:
                segments.append(current)
            attrs = edge_attrs_for_segment(d)
            current = {
                "risk_class": rclass,
                "highway": _flatten(attrs["highway"]),
                "moto_lane": _is_moto(attrs["motorcycle"]),
                "flood_prone": _is_flood(attrs),
                "length_m": length_m,
                "coords": [u_xy, v_xy],
                "_edge_count": 1,
            }
    if current is not None:
        segments.append(current)

    # Round lengths for cleaner output; coords stay full precision.
    for s in segments:
        s["length_m"] = round(s["length_m"], 1)
    return segments


def pick_edge(G, u, v):
    """Choose the lowest-risk edge between u and v (multi-edges exist)."""
    data = G.get_edge_data(u, v)
    if not data:
        return None
    best = None
    best_w = None
    for d in data.values():
        w = d.get("risk_weight", float("inf"))
        if best is None or w < best_w:
            best, best_w = d, w
    return best


def _flatten(v):
    if isinstance(v, list):
        return v[0] if v else ""
    return str(v) if v is not None else ""


def _is_moto(m):
    if isinstance(m, list):
        return any(str(x) in ("designated", "yes") for x in m)
    return str(m) in ("designated", "yes")


def _is_flood(attrs):
    if str(attrs.get("flood_prone", "")).lower() == "yes":
        return True
    note = attrs.get("note", "")
    if isinstance(note, list):
        note = " ".join(str(n) for n in note)
    return "flood" in str(note).lower()


def total_length_km(segments):
    return round(sum(s["length_m"] for s in segments) / 1000.0, 1)


def high_risk_km(segments):
    return round(
        sum(s["length_m"] for s in segments if s["risk_class"] in HIGH_RISK_CLASSES)
        / 1000.0,
        1,
    )


def moto_lane_km(segments):
    return round(
        sum(s["length_m"] for s in segments if s["risk_class"] == "moto_lane") / 1000.0,
        1,
    )


def flood_prone_segments(segments):
    return sum(1 for s in segments if s["risk_class"] == "flood")


def duration_min(G, route, weight_key):
    """Sum the chosen weight; if travel_time, convert s -> min."""
    total = 0.0
    for u, v in zip(route[:-1], route[1:]):
        d = pick_edge(G, u, v)
        if d is None:
            continue
        total += float(d.get(weight_key, 0.0))
    if weight_key == "travel_time":
        return int(round(total / 60.0))
    # No travel_time: estimate ~50 km/h on the length fallback.
    return int(round((total / 1000.0) / 50.0 * 60.0))


def build_reasons(fast, low):
    """Generate comparison.reasons from the actual computed difference."""
    reasons = []

    fast_high = fast["exposure"]["high_risk_km"]
    low_high = low["exposure"]["high_risk_km"]
    avoided_high = round(fast_high - low_high, 1)
    if avoided_high >= 0.1:
        reasons.append(
            f"Avoids {avoided_high:.1f} km of high-risk road "
            f"(motorway/trunk/primary shared with heavy vehicles)"
        )

    moto = low["exposure"]["moto_lane_km"]
    if moto > 0.5:
        reasons.append(
            f"Uses segregated motorcycle lane for {moto:.1f} km"
        )

    if fast["exposure"]["flood_prone_segments"] > 0:
        reasons.append(
            f"Avoids {fast['exposure']['flood_prone_segments']} flood-prone segment(s) "
            f"on the fastest route"
        )

    if not reasons:
        reasons.append(
            "Both routes have similar exposure; the lower-exposure route is not "
            "meaningfully different for this corridor."
        )
    return reasons


def exposure_reduction_pct(fast, low):
    base = fast["exposure"]["high_risk_km"]
    if base <= 0:
        return 0
    return int(round((base - low["exposure"]["high_risk_km"]) / base * 100))


def extra_minutes(fast, low):
    return max(0, low["duration_min"] - fast["duration_min"])


def route_obj(G, route, rtype, label, weight_key):
    segments = route_to_segments(G, route)
    return {
        "type": rtype,
        "label": label,
        "distance_km": total_length_km(segments),
        "duration_min": duration_min(G, route, weight_key),
        "exposure": {
            "high_risk_km": high_risk_km(segments),
            "moto_lane_km": moto_lane_km(segments),
            "flood_prone_segments": flood_prone_segments(segments),
        },
        "segments": segments,
        # keep the raw node path so we can compare geometry between routes
        "_node_path": list(route),
    }


def export_corridor(corridor, G, G_road):
    cid = corridor["id"]
    orig = ox.nearest_nodes(G_road, corridor["origin"]["lon"], corridor["origin"]["lat"])
    dest = ox.nearest_nodes(
        G_road, corridor["destination"]["lon"], corridor["destination"]["lat"]
    )

    for night in (False, True):
        time_of_day = "night" if night else "day"
        annotate_edges(G, night=night)
        wkey = fastest_weight_key(G)

        fast_route = nx.shortest_path(G, orig, dest, weight=wkey)
        low_route = nx.shortest_path(G, orig, dest, weight="risk_weight")

        fast = route_obj(G, fast_route, "fastest", "Fastest route", wkey)
        low = route_obj(
            G, low_route, "lower_exposure", "Lower exposure route", wkey
        )

        if fast["_node_path"] == low["_node_path"]:
            print(
                f"  [{time_of_day}] WARNING: fastest and lower-exposure routes "
                f"are identical. Reporting as-is; not tuning weights."
            )

        comparison = {
            "extra_minutes": extra_minutes(fast, low),
            "exposure_reduction_pct": exposure_reduction_pct(fast, low),
            "reasons": build_reasons(fast, low),
        }

        out = {
            "corridor_id": cid,
            "time_of_day": time_of_day,
            "routes": [
                {k: v for k, v in fast.items() if k != "_node_path"},
                {k: v for k, v in low.items() if k != "_node_path"},
            ],
            "comparison": comparison,
        }

        path = os.path.join(DATA_DIR, f"{cid}_{time_of_day}.json")
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
        print(
            f"  [{time_of_day}] wrote {path} | "
            f"fastest {fast['distance_km']}km/{fast['duration_min']}min "
            f"high={fast['exposure']['high_risk_km']}km | "
            f"lower {low['distance_km']}km/{low['duration_min']}min "
            f"high={low['exposure']['high_risk_km']}km moto={low['exposure']['moto_lane_km']}km"
        )


def write_corridors_index():
    """Refresh data/corridors.json from the in-memory corridor list."""
    payload = {"corridors": CORRIDORS}
    path = os.path.join(DATA_DIR, "corridors.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}")


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    G, G_road = load_graph()
    print(f"graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    write_corridors_index()
    for corridor in CORRIDORS:
        print(f"exporting {corridor['id']}")
        export_corridor(corridor, G, G_road)


if __name__ == "__main__":
    main()
