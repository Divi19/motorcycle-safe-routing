"""
Live routing API. FastAPI app that loads graph.pkl once at startup.

Run:
  python build/build_graph_cache.py   # one-time graph build
  uvicorn build.api:app --reload      # start the server

GET /route?olat=&olon=&dlat=&dlon=&night=false
  Returns JSON matching BUILD_CONTEXT section 7 — the same shape the
  frontend already consumes from data/*.json.
"""

import os
import pickle
import sys
import time

import networkx as nx
import osmnx as ox
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import confloat

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

PICKLE_PATH = os.path.join(HERE, "graph.pkl")

# Bbox must match build_graph_cache.py so the 422 guard is accurate.
BBOX = (101.50, 3.00, 101.75, 3.20)  # (west, south, east, north)
BBOX_WEST, BBOX_SOUTH, BBOX_EAST, BBOX_NORTH = BBOX

HIGH_RISK_CLASSES = {"high", "flood"}

app = FastAPI(title="Motorcycle Risk-Weighted Router")

# CORS enabled for all origins — the frontend is static and may be served
# from any domain (Vercel, localhost, etc.).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Graph loading (once at startup) -----------------------------------------

# osmnx.nearest_nodes needs the tags config to match the cached graph, but
# since the graph is already built and pickled, this only affects any
# incidental osmnx calls. Set it for safety/consistency.
ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]

if not os.path.exists(PICKLE_PATH):
    raise RuntimeError(
        f"{PICKLE_PATH} not found. Run `python build/build_graph_cache.py` first."
    )

_t0 = time.time()
with open(PICKLE_PATH, "rb") as f:
    _cache = pickle.load(f)
G = _cache["G"]
G_road = _cache["G_road"]
print(
    f"loaded graph.pkl: {G.number_of_nodes()} nodes, "
    f"{G.number_of_edges()} edges in {time.time() - _t0:.1f}s"
)

# travel_time is present if osmnx added speed data; otherwise fall back to length.
_FASTEST_WEIGHT = "travel_time" if all(
    "travel_time" in d for _, _, d in G.edges(data=True)
) else "length"


# --- Helpers (mirrors build/export_routes.py logic) --------------------------

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


def pick_edge(u, v):
    """Choose the lowest-risk edge between u and v (multi-edges exist)."""
    data = G.get_edge_data(u, v)
    if not data:
        return None
    best, best_w = None, None
    for d in data.values():
        w = d.get("risk_weight_day", float("inf"))
        if best is None or w < best_w:
            best, best_w = d, w
    return best


def route_to_segments(route):
    """Merge consecutive same-risk_class edges into segments."""
    segments = []
    current = None

    for u, v in zip(route[:-1], route[1:]):
        d = pick_edge(u, v)
        if d is None:
            continue

        rclass = d["risk_class"]
        length_m = float(d.get("length", 0.0))
        u_xy = (float(G.nodes[u]["y"]), float(G.nodes[u]["x"]))
        v_xy = (float(G.nodes[v]["y"]), float(G.nodes[v]["x"]))

        if current and current["risk_class"] == rclass:
            current["coords"].append(v_xy)
            current["length_m"] += length_m
            current["_edge_count"] += 1
        else:
            if current is not None:
                segments.append(current)
            current = {
                "risk_class": rclass,
                "highway": _flatten(d.get("highway", "")),
                "moto_lane": _is_moto(d.get("motorcycle", "")),
                "flood_prone": _is_flood(d),
                "length_m": length_m,
                "coords": [u_xy, v_xy],
                "_edge_count": 1,
            }
    if current is not None:
        segments.append(current)

    for s in segments:
        s["length_m"] = round(s["length_m"], 1)
    return segments


def total_length_km(segments):
    return round(sum(s["length_m"] for s in segments) / 1000.0, 1)


def high_risk_km(segments):
    return round(
        sum(s["length_m"] for s in segments if s["risk_class"] in HIGH_RISK_CLASSES)
        / 1000.0, 1)


def moto_lane_km(segments):
    return round(
        sum(s["length_m"] for s in segments if s["risk_class"] == "moto_lane")
        / 1000.0, 1)


def flood_prone_segments(segments):
    return sum(1 for s in segments if s["risk_class"] == "flood")


def duration_min(route, weight_key):
    total = 0.0
    for u, v in zip(route[:-1], route[1:]):
        d = pick_edge(u, v)
        if d is None:
            continue
        total += float(d.get(weight_key, 0.0))
    if weight_key == "travel_time":
        return int(round(total / 60.0))
    return int(round((total / 1000.0) / 50.0 * 60.0))


def build_reasons(fast, low):
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
        reasons.append(f"Uses segregated motorcycle lane for {moto:.1f} km")
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


def route_obj(route, rtype, label, weight_key):
    segments = route_to_segments(route)
    return {
        "type": rtype,
        "label": label,
        "distance_km": total_length_km(segments),
        "duration_min": duration_min(route, weight_key),
        "exposure": {
            "high_risk_km": high_risk_km(segments),
            "moto_lane_km": moto_lane_km(segments),
            "flood_prone_segments": flood_prone_segments(segments),
        },
        "segments": segments,
        "_node_path": list(route),
    }


# --- Bbox guard --------------------------------------------------------------

def _check_bbox(lat, lon, label):
    if not (BBOX_SOUTH <= lat <= BBOX_NORTH and BBOX_WEST <= lon <= BBOX_EAST):
        raise HTTPException(
            status_code=422,
            detail=(
                f"{label} ({lat}, {lon}) falls outside the supported bounding box "
                f"({BBOX_WEST}, {BBOX_SOUTH}, {BBOX_EAST}, {BBOX_NORTH}). "
                f"Rebuild the graph cache with a wider bbox to include this point."
            ),
        )


# --- Endpoint ----------------------------------------------------------------

@app.get("/route")
def route(
    olat: confloat(ge=-90, le=90),
    olon: confloat(ge=-180, le=180),
    dlat: confloat(ge=-90, le=90),
    dlon: confloat(ge=-180, le=180),
    night: bool = Query(False),
):
    _check_bbox(olat, olon, "origin")
    _check_bbox(dlat, dlon, "destination")

    # Snap to G_road (not the composed G) to avoid landing on isolated
    # motorcycle-lane nodes that have no directed path to the destination.
    # Matches export_routes.py.
    orig = ox.nearest_nodes(G_road, olon, olat)
    dest = ox.nearest_nodes(G_road, dlon, dlat)

    risk_weight_key = "risk_weight_night" if night else "risk_weight_day"

    try:
        fast_route = nx.shortest_path(G, orig, dest, weight=_FASTEST_WEIGHT)
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=422, detail="No path found between origin and destination.")
    try:
        low_route = nx.shortest_path(G, orig, dest, weight=risk_weight_key)
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=422, detail="No path found between origin and destination.")

    fast = route_obj(fast_route, "fastest", "Fastest route", _FASTEST_WEIGHT)
    low = route_obj(low_route, "lower_exposure", "Lower exposure route", _FASTEST_WEIGHT)

    if fast["_node_path"] == low["_node_path"]:
        print("WARNING: fastest and lower-exposure routes are identical; not tuning weights.")

    comparison = {
        "extra_minutes": extra_minutes(fast, low),
        "exposure_reduction_pct": exposure_reduction_pct(fast, low),
        "reasons": build_reasons(fast, low),
    }

    return {
        "corridor_id": "live",
        "time_of_day": "night" if night else "day",
        "routes": [
            {k: v for k, v in fast.items() if k != "_node_path"},
            {k: v for k, v in low.items() if k != "_node_path"},
        ],
        "comparison": comparison,
    }


@app.get("/health")
def health():
    return {"status": "ok", "nodes": G.number_of_nodes(), "edges": G.number_of_edges()}
