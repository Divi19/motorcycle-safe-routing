# DEVIN TICKETS

Read `BUILD_CONTEXT.md` first for stack, structure, and constraints.
Work **one ticket at a time**. Do not start a ticket from a later wave.

---

# WAVE 1 — dispatch all three at minute 0

These have no dependencies on each other. The goal of Wave 1 is a **live URL within
30 minutes**, rendering fixture data.

---

## Ticket 1.1 — Graph loader

**Scope:** create `build/load_graph.py` only.

Load the Klang Valley graph per the pattern in BUILD_CONTEXT section 5. Compose
`G_road` (network_type drive) with `G_moto` (custom_filter on `motorcycle`).

Then drop any edge carrying an `amenity` or `building` tag.

**Done when** `python build/load_graph.py` prints exactly these four lines:

```
NODES: <int>
EDGES: <int>
MOTO_EDGES: <int>
PATH_EDGES_RETAINED: <int>
```

`MOTO_EDGES` counts edges where the `motorcycle` tag is `designated` or `yes`.

**Must exit with code 1** if `MOTO_EDGES` is 0. The script must fail loudly, not
return an empty graph.

**Do not** modify any other file. **Do not** run routing.

---

## Ticket 1.2 — Frontend against fixture

**Scope:** create `index.html`, `style.css`, `app.js`, and `data/` only.

Copy the supplied fixture into `data/shah_alam_midvalley_day.json`. Duplicate it as
`..._night.json` for now. Create `data/corridors.json` per the contract.

Build a single-page Leaflet app:

- Full-width map, centred on the corridor
- Both routes drawn as polylines from `segments[].coords`
- Segment colour driven **only** by `risk_class`:
  `low` green, `medium` amber, `high` red, `moto_lane` blue, `flood` purple
- A corridor dropdown populated from `corridors.json`
- A day/night toggle that reloads the matching JSON file
- A results panel showing, for each route: distance, duration, `high_risk_km`,
  `moto_lane_km`
- The `comparison.reasons` array rendered as a bulleted list, prominently
- A legend for the five colours

**Done when** opening `index.html` in a browser renders two coloured routes, the
toggle switches files without error, and the browser console is clean.

**Do not** compute anything in JavaScript. Every number displayed must come
directly from the JSON. **Do not** add a build step, bundler, or framework —
plain HTML/CSS/JS with Leaflet from CDN.

---

## Ticket 1.3 — Deploy

**Scope:** deployment configuration only.

Deploy the static site from Ticket 1.2 to Vercel as a public site. No auth, no
password. It must remain reachable after our machines are closed.

**Done when** you return a public HTTPS URL that loads the map with fixture data in
a fresh incognito window.

**Do not** deploy any Python. **Do not** set up serverless functions.

---

# WAVE 2 — dispatch after Ticket 1.1 passes

---

## Ticket 2.1 — Weights module

**Scope:** create `build/weights.py` and `build/test_weights.py` only.

Implement `risk_multiplier(edge_attrs) -> float` exactly per the tables in
BUILD_CONTEXT section 6. Base multiplier by highway class, then modifiers applied
multiplicatively. Signature must accept a `night: bool` parameter.

Also implement `risk_class(edge_attrs) -> str` returning one of
`low | medium | high | moto_lane | flood`, using this precedence:
flood > moto_lane > class-based (motorway/trunk = high, primary/secondary = medium,
else low).

**Done when** `python -m pytest build/test_weights.py` passes with at least these
cases:

- `{"highway": "trunk"}` → 2.5
- `{"highway": "trunk", "motorcycle": "designated"}` → 0.75
- `{"highway": "trunk"}, night=True` → 3.5
- `{"highway": "residential"}` → 1.0
- `{"highway": "primary", "flood_prone": "yes"}` → 6.0
- `{"highway": "cycleway", "motorcycle": "designated"}` → risk_class == "moto_lane"

**Do not** modify `load_graph.py`.

---

## Ticket 2.2 — Route export

**Scope:** create `build/export_routes.py` only.

For each corridor and each of day/night: apply `risk_multiplier` to every edge as
`edge["risk_weight"] = length_m * multiplier`, then compute two routes with
`nx.shortest_path`:

- `fastest` — weight = `travel_time` (or `length` if travel_time is unavailable)
- `lower_exposure` — weight = `risk_weight`

Emit JSON matching the contract in BUILD_CONTEXT section 7, written to `data/`.

Consecutive edges sharing the same `risk_class` must be merged into one segment.

`comparison.reasons` must be generated from the actual computed difference, not
hardcoded. Include a reason mentioning the motorcycle lane only if
`moto_lane_km > 0.5`, and a flood reason only if the fastest route has
`flood_prone_segments > 0`.

**Done when** `python build/export_routes.py` writes valid JSON files that the
existing frontend loads with no console errors, and both routes differ in geometry.

**If the two routes are identical**, stop and report it — do not tune weights to
force a difference.

---

# WAVE 3 — after Wave 2

---

## Ticket 3.1 — Edge cases

The rubric requires handling "a few basic edge cases". Add only these:

- If a JSON file is missing, show a clear message in the results panel instead of a
  blank map or a console error
- If `segments` is empty, do not crash
- Loading spinner while a JSON file is being fetched

**Done when** deleting a data file and reloading shows a readable message rather
than a broken page.

---

## Ticket 3.2 — Mobile

Make the layout usable on a phone viewport (375px). Map on top, results panel
below, scrollable.

**Done when** the page is usable at 375px wide with no horizontal scroll.

---

# NOT FOR DEVIN

These stay with the team:

- Choosing and justifying the risk weights
- Verifying the routed path actually contains `motorcycle=designated` edges
- The pitch narrative and the numbers stated on stage
- Any decision about what a number means
