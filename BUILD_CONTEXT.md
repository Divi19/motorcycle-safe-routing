# BUILD CONTEXT — Motorcycle Risk-Weighted Router

> **THIS IS REFERENCE MATERIAL, NOT AN INSTRUCTION TO BUILD.**
> Do not start work from this document. Work only from tickets in `DEVIN_TICKETS.md`.

---

## 1. What the product is

A risk-weighted route planner for Malaysian motorcyclists. Google Maps routes a
motorcycle like a car. We route over `risk × distance` instead of time, using
OpenStreetMap road attributes plus a time-of-day multiplier.

Output: one map, two routes, and a plain-language reason for the difference.

**Framing:** this is *risk-weighted routing*, NOT crash prediction. Never claim to
predict crashes or deaths anywhere in code comments, UI copy, or output text.

---

## 2. Stack — do not substitute

| Layer | Choice |
|---|---|
| Graph + routing | Python, OSMnx v2 + NetworkX |
| Output | Static JSON files |
| Frontend | Leaflet, vanilla JS, single HTML page |
| Hosting | Vercel (static) |

**No backend server. No database. No build framework.** The frontend reads JSON
files from `/data/` and nothing else.

---

## 3. File structure

```
/
├── index.html          # Leaflet frontend, single file
├── style.css
├── app.js
├── data/
│   ├── corridors.json  # list of available corridors
│   ├── shah_alam_midvalley_day.json
│   ├── shah_alam_midvalley_night.json
│   └── ...             # one file per corridor × time
└── build/              # Python, NOT deployed
    ├── load_graph.py
    ├── weights.py
    └── export_routes.py
```

---

## 4. Demo corridor

**Shah Alam / Batu Tiga → Petaling Jaya → Seputeh / Mid Valley**

| Point | Lat | Lon |
|---|---|---|
| Origin (Batu Tiga) | 3.0743 | 101.5557 |
| Destination (Seputeh) | 3.1144 | 101.6785 |

BBOX for OSMnx v2 — `(west, south, east, north)`:
```python
BBOX = (101.54, 3.06, 101.69, 3.13)
```

Real Google Maps figures for this corridor (for pitch comparison only, not code):
- Fastest: 24 min, 24.5 km — Federal Highway + tolled Lebuhraya Baru Pantai (E10)
- Alternative: 26 min, 20.8 km — stays on Route 2, motorcycle lane runs parallel

---

## 5. Graph construction — the critical part

Motorcycle lane segments carry `motor_vehicle=no`. OSMnx's `drive` AND
`drive_service` filters both silently drop them. Two graphs must be composed:

```python
import osmnx as ox, networkx as nx

BBOX = (101.54, 3.06, 101.69, 3.13)

G_road = ox.graph_from_bbox(bbox=BBOX, network_type="drive", simplify=False)

G_moto = ox.graph_from_bbox(
    bbox=BBOX,
    custom_filter='["motorcycle"~"designated|yes"]',
    retain_all=True,
    simplify=False,
)

G = nx.compose(G_road, G_moto)
```

A motorcycle-only graph has no connecting streets, so nothing routes. A drive graph
excludes the lanes. You need both.

### Tagging reality (verified against live OSM data, Aug 2026)

- The OSM wiki says Malaysian motorcycle lanes are `highway=path`. **This is wrong.**
  They appear as `highway=service`, `highway=cycleway`, and `highway=path`.
- **The reliable selector is `motorcycle=designated` (or `yes`)**, independent of
  highway class. Select on this, never on highway class.
- Filter out non-roads: exclude anything carrying an `amenity` or `building` tag.
  Some shelters and parking roofs are tagged `motorcycle=designated`.

### Known risk

Several ways near Bangsar/Seputeh (lon ~101.66–101.68) carry
`fixme=check geometry and connectivity`. That is the eastern end of the corridor.
If topology breaks there, **terminate the corridor at Petaling Jaya instead**. This
costs nothing on stage.

---

## 6. Risk weights

Cost of an edge = `length_metres × risk_multiplier`

### Base multiplier by road class

| `highway` | Multiplier | Rationale |
|---|---|---|
| `motorway`, `motorway_link` | 3.0 | Highest speed differential with heavy vehicles |
| `trunk`, `trunk_link` | 2.5 | Shared carriageway, high speed, lorry traffic |
| `primary`, `primary_link` | 2.0 | Primary roads carry the largest share of fatalities |
| `secondary` | 1.5 | |
| `tertiary` | 1.2 | |
| `residential`, `unclassified`, `living_street` | 1.0 | Baseline |
| *anything else* | 1.5 | Conservative default |

### Modifiers, applied multiplicatively

| Condition | Multiplier | Rationale |
|---|---|---|
| `motorcycle` in (`designated`, `yes`) | **× 0.3** | Segregated infrastructure; strongest available protective factor |
| `flood_prone=yes` OR `note` contains "flood" | **× 3.0** | Verified in live OSM data on this corridor |
| Night AND class in (motorway, trunk, primary) | **× 1.4** | Global darkness proxy |

### Why a global night multiplier and not per-road lighting

Measured `lit` tag coverage on major KL roads: **682 of 12,991 ways = 5.3%.**
Too sparse to use. A per-segment lighting weight would reflect which roads a mapper
happened to survey, not actual darkness.

If asked: *"We measured coverage at 5.3% and chose not to build on it."*

### Honesty requirement — state this proactively in the pitch

Published figures like "62% of motorcycle fatalities occur on primary roads" are
**confounded by exposure** — most riding happens on primary roads. Without
vehicle-kilometres-travelled by road class, share-of-fatalities cannot be converted
into a per-segment risk multiplier.

These weights are **informed judgment calibrated against published aggregates**,
not a derivation. Say so out loud. A team that flags its own limitation reads as
rigorous; an overclaimed derivation that gets caught discounts everything else.

---

## 7. JSON output contract

**This contract is frozen. The frontend and the router both build against it.**

### `data/corridors.json`

```json
{
  "corridors": [
    {
      "id": "shah_alam_midvalley",
      "label": "Shah Alam → Mid Valley",
      "origin": {"lat": 3.0743, "lon": 101.5557, "name": "Batu Tiga"},
      "destination": {"lat": 3.1144, "lon": 101.6785, "name": "Seputeh"}
    }
  ]
}
```

### `data/{corridor_id}_{day|night}.json`

```json
{
  "corridor_id": "shah_alam_midvalley",
  "time_of_day": "day",
  "routes": [
    {
      "type": "fastest",
      "label": "Fastest route",
      "distance_km": 24.5,
      "duration_min": 24,
      "exposure": {
        "high_risk_km": 4.2,
        "moto_lane_km": 0.4,
        "flood_prone_segments": 1
      },
      "segments": [
        {
          "risk_class": "high",
          "highway": "trunk",
          "moto_lane": false,
          "flood_prone": false,
          "length_m": 820,
          "coords": [[3.0743, 101.5557], [3.0751, 101.5602]]
        }
      ]
    },
    {
      "type": "lower_exposure",
      "label": "Lower exposure route",
      "distance_km": 20.8,
      "duration_min": 26,
      "exposure": {
        "high_risk_km": 0.9,
        "moto_lane_km": 6.1,
        "flood_prone_segments": 0
      },
      "segments": []
    }
  ],
  "comparison": {
    "extra_minutes": 2,
    "exposure_reduction_pct": 79,
    "reasons": [
      "Avoids 3.3 km of trunk road shared with heavy vehicles",
      "Uses the Federal Highway motorcycle lane for 6.1 km",
      "Avoids a flood-prone underpass"
    ]
  }
}
```

**`risk_class`** is one of `low`, `medium`, `high`, `moto_lane`, `flood` — the
frontend colours segments from this field alone and does no calculation.

**`coords`** are `[lat, lon]` pairs, in Leaflet order.

---

## 8. Do NOT

- Do not use `network_type="drive"` or `"drive_service"` alone for the lane graph
- Do not select motorcycle lanes by highway class
- Do not add a backend server, API, or database
- Do not call Overpass at runtime — all data is baked to disk before the demo
- Do not install packages beyond: `osmnx`, `networkx`, `shapely`
- Do not touch files outside the scope stated in your ticket
- Do not use the words "predict", "safe route", or "guarantees" in UI copy.
  Use "lower exposure" instead of "safe"
