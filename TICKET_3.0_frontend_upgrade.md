# TICKET 3.0 — Frontend presentation upgrade

**Scope:** `index.html`, `style.css`, `app.js` ONLY.
Do not touch `build/`, `data/`, or any Python.

The page works but presents its result as a spec sheet. The comparison between the two
routes is the product, and right now a viewer has to do the arithmetic themselves.

Build in the priority order below. If time runs short, ship 1–3.

---

## 1. HEADLINE DELTA BANNER

Directly above the map, full width, visually dominant — the largest text on the page.

Computed from the loaded JSON at runtime. Recomputes on every corridor change and
day/night toggle. Nothing hardcoded.

```js
exposure_reduction = (fastest.high_risk_km - lower.high_risk_km) / fastest.high_risk_km
extra_minutes      = lower.duration_min - fastest.duration_min
```

Three figures in one row:

```
      94%                  +2 min                 15.6 km
less high-risk road    extra travel time     on segregated lane
                                                (vs 0 km)
```

The percentage is the largest element on the page.

Guard against divide-by-zero if `fastest.high_risk_km` is 0 — hide the percentage
rather than showing NaN.

---

## 2. EXPOSURE COMPOSITION BARS

Inside each route card, add a horizontal stacked bar showing how that route decomposes
by `risk_class`. Use the same colours as the map legend.

Compute by summing `length_m` per `risk_class` across that route's `segments` array,
then rendering each class as a proportional width.

- Tooltip on hover: class name and km
- One summary line beneath each bar: `11.1 km high-risk · 0 km lane`

Two bars stacked vertically. The contrast between a mostly-red bar and a mostly-blue
one is the point.

Keep the existing distance/duration figures; the bar replaces the raw high-risk and
lane km rows.

---

## 3. FRAMING LINE + FOOTER

**One line above the map**, above the headline banner. Not a band, not a hero section —
a single sentence:

> Two in three Malaysians killed on the road are on a motorcycle. Google Maps routes
> them like cars.

**Page footer**, small text, muted:

- Road deaths 2025: 4,340 of 6,537 were motorcycle users — Transport Minister Anthony
  Loke, Dewan Rakyat, 27 Jan 2026
- Motorcycles are 47% of registered vehicles; ~3% of road infrastructure rates 3-star
  or better for them, vs ~49% for vehicle occupants — Asian Transport Observatory,
  Malaysia Road Safety Profile 2025
- Road data: OpenStreetMap contributors (ODbL)
- **Advisory only. Does not replace rider judgment or road-legal navigation.**

---

## 4. NIGHT TOGGLE EXPLANATION

When Night is active, show a short line beside or beneath the toggle:

> After dark, motorway, trunk and primary roads carry a 1.4× weight.

Hidden when Day is active. Currently the numbers change with no stated reason.

---

## 5. METHODOLOGY — QUIET, COLLAPSED

A small text link at the bottom of the results panel: **"How this works"**.
Collapsed by default. Must not compete visually with the map or results.

When expanded:

**Weights** — compact table: motorway 3.0, trunk 2.5, primary 2.0, secondary 1.5,
tertiary 1.2, residential 1.0. Modifiers: `motorcycle=designated` ×0.3,
`flood_prone` ×3.0, night on high-speed classes ×1.4. Cost = length × multiplier.

**Limitations** — four short paragraphs:

1. Published figures such as "62% of motorcycle fatalities occur on primary roads" are
   confounded by exposure — most riding happens on primary roads. These weights are
   informed judgment calibrated against published aggregates, not a derivation from
   crash data.
2. Lighting excluded: measured `lit` tag coverage was 682 of 12,991 major KL roads
   (5.3%), too sparse to use. Darkness is handled as a global night multiplier.
3. Routes are precomputed for demo reliability. Every route shown is genuine router
   output.
4. Malaysia's crash blackspot locations are held by KKR, LLM and JKR and are not
   published as open data. Exposure is inferred from road attributes instead.

---

## 6. LEGEND FIX

The "Motorcycle lane" entry in the risk-class legend renders without a colour swatch,
unlike Low, Medium, High and Flood-prone. Fix it to show the same blue used for
`moto_lane` segments on the map.

---

## Constraints

- No frameworks, no bundler. Plain HTML/CSS/JS, Leaflet from CDN.
- Every figure computed from the JSON at runtime. Only the citation text in sections
  3 and 5 is static.
- Map must remain visible without scrolling on a 1440px-tall screen.
- Usable at 375px width — banner figures and bars stack vertically.
- Console clean.
- Do not use the word "safe" anywhere. Use "lower exposure".

**Done when:** headline recomputes on corridor and time change, composition bars render
from segment data, night explanation appears only on Night, methodology expands, legend
swatch shows.

Commit and push to `main`.
