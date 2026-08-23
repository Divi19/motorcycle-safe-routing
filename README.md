# RLTN — Rather Late Than Never

Motorcycle risk-weighted routing for Malaysia. RLTN routes over risk × distance instead of time, using OpenStreetMap road attributes to find a lower-exposure alternative to the fastest route.

## The problem

Of 6,537 Malaysian road deaths in 2025, 4,340 (66.4%) were motorcycle users — despite motorcycles being involved in only 13.7% of reported accidents. Motorcycles are 47% of registered vehicles, yet only ~3% of road infrastructure rates 3-star or better for motorcyclists, versus ~49% for vehicle occupants.

Google Maps routes a motorcycle exactly like a car. On a Shah Alam to Mid Valley commute, the default fastest route uses 11.1 km of high-risk road (motorway/trunk/primary shared with heavy vehicles) and zero metres of the segregated motorcycle lane running alongside it.

## How it works

Routing cost for each road segment is `length × risk_multiplier`, not `travel_time`. The multiplier is determined by road class, motorcycle infrastructure, flood tags, and time of day.

### Weights

| Road class | Base multiplier |
|---|---|
| motorway / motorway_link | 3.0 |
| trunk / trunk_link | 2.5 |
| primary / primary_link | 2.0 |
| secondary / secondary_link | 1.5 |
| tertiary / tertiary_link | 1.2 |
| residential / service / unclassified | 1.0 |
| default (unknown) | 1.5 |

**Modifiers:**

- `motorcycle=designated|yes` → ×0.3 (segregated infrastructure)
- `flood_prone=yes` (or a `note` tag containing "flood") → ×3.0, rendered as a distinct risk class (purple on the map)
- Night on motorway/trunk/primary → ×1.4

No flood-tagged segments fall on the demo corridors, so this modifier does not affect the reported results. The capability is implemented and verified in the weights unit tests (`build/test_weights.py`), but untriggered on these routes.

### Two-graph compose

Motorcycle lanes in OSM carry `motor_vehicle=no`, which causes OSMnx's `drive` and `drive_service` network types to silently drop them. To include motorcycle infrastructure, two graphs are downloaded separately and composed:

1. `G_road` — `network_type="drive"` (the car network)
2. `G_moto` — `custom_filter='["motorcycle"~"designated|yes"]'` with `retain_all=True`

The composed graph `G = nx.compose(G_road, G_moto)` carries both car roads and motorcycle-only lanes. Route endpoints are snapped to `G_road` (not the composed graph) to avoid snapping to disconnected motorcycle-lane nodes.

## Results

Shah Alam (3.0743, 101.5557) → Mid Valley (3.1144, 101.6785):

| | Day fastest | Day lower exposure | Night fastest | Night lower exposure |
|---|---|---|---|---|
| Distance | 17.9 km | 19.0 km | 17.9 km | 20.2 km |
| Duration | 21 min | 23 min | 21 min | 24 min |
| High-risk km | 11.1 | 0.7 | 11.1 | 0.3 |
| Motorcycle lane km | 0.0 | 15.6 | 0.0 | 15.6 |

The lower-exposure route trades ~2 minutes of travel time for a 94% reduction in high-risk road usage (day) by routing onto 15.6 km of segregated motorcycle lane.

## Architecture

- **Frontend**: Static HTML/CSS/JavaScript with Leaflet 1.9.4 from CDN. Deployed on Vercel. No build step, no framework.
- **Live routing**: FastAPI service (`build/api.py`) loads a pickled NetworkX graph at startup and computes routes on demand. Graph cache built by `build/build_graph_cache.py`.
- **Static fallback**: Precomputed route JSON in `data/` is served when the API is unreachable. The frontend attempts the API first with a 6-second timeout, then falls back to static JSON and shows a muted notice.
- **Shared contract**: Both the live API and static JSON return the same response shape — `corridor_id`, `time_of_day`, `routes[]` (each with `type`, `segments[]` carrying `coords`, `risk_class`, `length_m`), and `comparison` (with `reasons[]`). The frontend renders both identically.

## Running it locally

### Prerequisites

- Python 3.9+
- [OSMnx](https://github.com/gboeing/osmnx), NetworkX, FastAPI, Uvicorn

### Install

```bash
pip install osmnx networkx fastapi uvicorn
```

### Build the graph cache

```bash
cd build
python build_graph_cache.py
```

This downloads the OSM road and motorcycle-lane graphs for the Klang Valley corridor, annotates each edge with risk weights, and pickles the result to `build/graph.pkl` (~97 MB).

### Start the API

```bash
cd build
uvicorn api:app --port 8000
```

### Serve the frontend

```bash
python -m http.server 8765
```

Open `http://localhost:8765` in a browser. The frontend reads the API base URL from a single constant (`API_BASE`) at the top of `app.js`.

## Data sources

- **Road network**: [OpenStreetMap](https://www.openstreetmap.org) contributors, ODbL licence, accessed via [OSMnx](https://github.com/gboeing/osmnx)
- **Geocoding**: [Nominatim](https://nominatim.openstreetmap.org) (place-name search, bounded to the Klang Valley viewbox)
- **Road deaths 2025**: 4,340 of 6,537 were motorcycle users — Transport Minister Anthony Loke, Dewan Rakyat, 27 Jan 2026
- **Infrastructure ratings**: Motorcycles are 47% of registered vehicles; ~3% of road infrastructure rates 3-star or better for motorcyclists vs ~49% for vehicle occupants — Asian Transport Observatory, Malaysia Road Safety Profile 2025

## Limitations

1. **Exposure confounding**: Published figures such as "62% of motorcycle fatalities occur on primary roads" are confounded by exposure — most riding happens on primary roads. These weights are informed judgment calibrated against published aggregates, not a derivation from crash data.

2. **Lighting excluded**: Measured `lit` tag coverage was 682 of 12,991 major KL roads (5.3%), too sparse to use. Darkness is handled as a global night multiplier instead of a per-segment attribute.

3. **Precomputed corridors**: Static route JSON is precomputed for demo reliability. Every route shown is genuine router output, but the static set covers only the Shah Alam → Mid Valley corridor.

4. **No open crash-location data**: Malaysia's crash blackspot locations are held by KKR, LLM and JKR and are not published as open data. Exposure is inferred from road attributes instead.

## Notable engineering finding

OSMnx retains only a default whitelist of way tags and silently drops any tag not on that list. The `motorcycle` and `flood_prone` tags — which the entire risk-weighting system depends on — were being discarded during graph download with no error or warning. The motorcycle-lane weight (×0.3) never fired, and the lower-exposure route was identical to the fastest route.

The fix is a single line before any graph download:

```python
ox.settings.useful_tags_way += ["motorcycle", "flood_prone", "note", "motor_vehicle"]
```

This is worth documenting because it fails silently: the graph builds successfully, routes compute successfully, and the only symptom is that the motorcycle-lane multiplier has no effect. After the fix, the lower-exposure route gained 15.6 km of segregated motorcycle lane.
