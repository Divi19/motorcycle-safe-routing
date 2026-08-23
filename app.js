"use strict";

// Live routing API base URL. Swap this one line to point at a different host.
const API_BASE = "https://administered-awarded-gnome-hours.trycloudflare.com";

// Nominatim geocoding endpoint. Bounded to the Klang Valley viewbox.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_VIEWBOX = "101.45,3.25,101.78,2.95"; // left,top,right,bottom

// Routing bbox — points outside this are rejected with a friendly message.
const ROUTE_BBOX = { west: 101.50, south: 3.00, east: 101.75, north: 3.20 };

// Risk-class -> colour. The frontend does no calculation; this map is the only
// place a colour is decided, driven solely by segment.risk_class.
const RISK_COLOURS = {
  low: "#2e8b57",
  medium: "#f5a623",
  high: "#d62828",
  moto_lane: "#1f6feb",
  flood: "#8338ec",
};

const RISK_CLASS_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  moto_lane: "Motorcycle lane",
  flood: "Flood-prone",
};

const state = {
  corridors: [],
  corridorId: null,
  timeOfDay: "day",
  // "static" = showing precomputed corridor JSON; "live" = showing API response
  mode: "static",
  // Selected geocoded points: { lat, lon, name }
  origin: null,
  dest: null,
};

const els = {
  corridorSelect: document.getElementById("corridor-select"),
  timeToggle: document.getElementById("time-toggle"),
  nightNote: document.getElementById("night-note"),
  fallbackNotice: document.getElementById("fallback-notice"),
  originInput: document.getElementById("origin-input"),
  destInput: document.getElementById("dest-input"),
  originResults: document.getElementById("origin-results"),
  destResults: document.getElementById("dest-results"),
  originResolved: document.getElementById("origin-resolved"),
  destResolved: document.getElementById("dest-resolved"),
  routeBtn: document.getElementById("route-btn"),
  map: document.getElementById("map"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  routesPanel: document.getElementById("routes-panel"),
  routeCards: document.getElementById("route-cards"),
  reasons: document.getElementById("reasons"),
  headline: document.getElementById("headline"),
  headlinePct: document.getElementById("headline-pct"),
  headlinePctWrap: document.getElementById("headline-pct-wrap"),
  headlineMin: document.getElementById("headline-min"),
  headlineLane: document.getElementById("headline-lane"),
  headlineLaneVs: document.getElementById("headline-lane-vs"),
  methodologyToggle: document.getElementById("methodology-toggle"),
  methodologyBody: document.getElementById("methodology-body"),
};

let map;
let routeLayers = []; // leaflet layers for the currently drawn routes
let routeTooltips = []; // permanent tooltip labels at route starts
// Map route type -> array of polylines, for hover highlighting.
let routeLayerGroups = { fastest: [], lower_exposure: [] };

function initMap() {
  map = L.map(els.map, { zoomControl: true }).setView([3.094, 101.617], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
}

function clearRoutes() {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];
  routeTooltips.forEach((t) => map.removeLayer(t));
  routeTooltips = [];
  routeLayerGroups = { fastest: [], lower_exposure: [] };
}

function drawRoute(route) {
  // Each segment is drawn as its own polyline so its colour comes only from
  // segment.risk_class. Adjacent segments share endpoints, so the route reads
  // as a continuous line.
  const isFastest = route.type === "fastest";
  const group = [];

  route.segments.forEach((seg) => {
    if (!seg.coords || seg.coords.length < 2) return;
    const colour = RISK_COLOURS[seg.risk_class] || "#888";
    const polyline = L.polyline(seg.coords, {
      color: colour,
      weight: 6,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
      // Fastest route: dashed stroke. Lower-exposure: solid.
      dashArray: isFastest ? "12,8" : null,
    }).addTo(map);
    routeLayers.push(polyline);
    group.push(polyline);
  });

  routeLayerGroups[route.type] = group;

  // Permanent tooltip label at the start of the route.
  const firstSeg = (route.segments || []).find((s) => s.coords && s.coords.length >= 2);
  if (firstSeg) {
    const startPoint = firstSeg.coords[0];
    const label = isFastest ? "Fastest" : "Lower exposure";
    const tooltip = L.tooltip({
      permanent: true,
      direction: "top",
      className: "route-label",
      offset: [0, -10],
    })
      .setLatLng(startPoint)
      .setContent(label)
      .addTo(map);
    routeTooltips.push(tooltip);
  }
}

/* --- Route hover highlight --- */

function highlightRoute(routeType) {
  Object.keys(routeLayerGroups).forEach((type) => {
    const isTarget = type === routeType;
    routeLayerGroups[type].forEach((poly) => {
      poly.setStyle({
        opacity: isTarget ? 1.0 : 0.25,
        weight: isTarget ? 8 : 6,
      });
    });
  });
}

function resetRouteHighlight() {
  Object.keys(routeLayerGroups).forEach((type) => {
    routeLayerGroups[type].forEach((poly) => {
      poly.setStyle({ opacity: 0.9, weight: 6 });
    });
  });
}

function fitToRoutes(routes) {
  const allPoints = [];
  routes.forEach((r) => (r.segments || []).forEach((s) => {
    (s.coords || []).forEach((c) => allPoints.push(c));
  }));
  if (allPoints.length === 0) return;
  // Force Leaflet to recalculate the map container size before fitting,
  // in case the results panel or headline just changed the layout.
  // Use double rAF so invalidateSize fully settles before fitBounds.
  map.invalidateSize();
  const bounds = L.latLngBounds(allPoints);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    });
  });
}

/* --- Exposure composition bar (item 2) --- */

function compositionForRoute(route) {
  // Sum length_m per risk_class across the route's segments.
  const totals = {};
  let total = 0;
  (route.segments || []).forEach((s) => {
    const cls = s.risk_class;
    const len = Number(s.length_m) || 0;
    totals[cls] = (totals[cls] || 0) + len;
    total += len;
  });
  return { totals, total };
}

function renderCompBar(route) {
  const { totals, total } = compositionForRoute(route);
  const bar = document.createElement("div");
  bar.className = "comp-bar";

  const order = ["high", "flood", "medium", "moto_lane", "low"];
  if (total > 0) {
    order.forEach((cls) => {
      const len = totals[cls] || 0;
      if (len <= 0) return;
      const seg = document.createElement("div");
      seg.className = "comp-bar-seg";
      seg.style.width = (len / total * 100) + "%";
      seg.style.background = RISK_COLOURS[cls] || "#888";
      const km = (len / 1000).toFixed(1);
      seg.title = RISK_CLASS_LABELS[cls] + ": " + km + " km";
      bar.appendChild(seg);
    });
  }

  const summary = document.createElement("p");
  summary.className = "comp-summary";
  const highKm = ((totals.high || 0) / 1000).toFixed(1);
  const laneKm = ((totals.moto_lane || 0) / 1000).toFixed(1);
  summary.textContent = highKm + " km high-risk \u00b7 " + laneKm + " km lane";

  const wrap = document.createDocumentFragment();
  wrap.appendChild(bar);
  wrap.appendChild(summary);
  return wrap;
}

function renderRouteCard(route) {
  const card = document.createElement("div");
  card.className = "route-card " + route.type;

  const heading = document.createElement("h2");
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = route.type === "fastest" ? "Fastest" : "Lower exposure";
  heading.appendChild(document.createTextNode(route.label || route.type));
  heading.appendChild(tag);
  card.appendChild(heading);

  // Distance + duration only. The bar replaces raw high-risk / lane km rows.
  const stats = document.createElement("div");
  stats.className = "route-stats";
  const rows = [
    ["Distance", route.distance_km != null ? route.distance_km + " km" : "—"],
    ["Duration", route.duration_min != null ? route.duration_min + " min" : "—"],
  ];
  rows.forEach(([label, value]) => {
    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;
    stats.appendChild(l);
    stats.appendChild(v);
  });
  card.appendChild(stats);

  // Composition bar + summary line.
  card.appendChild(renderCompBar(route));

  // Hover: highlight this route on the map, dim the other.
  card.addEventListener("mouseenter", () => highlightRoute(route.type));
  card.addEventListener("mouseleave", () => resetRouteHighlight());

  return card;
}

/* --- Headline delta banner (item 1) --- */

function renderHeadline(routes) {
  const fastest = routes.find((r) => r.type === "fastest");
  const lower = routes.find((r) => r.type === "lower_exposure");
  if (!fastest || !lower) {
    els.headline.hidden = true;
    return;
  }

  const fastHigh = fastest.exposure?.high_risk_km ?? 0;
  const lowHigh = lower.exposure?.high_risk_km ?? 0;
  const lowLane = lower.exposure?.high_risk_km != null
    ? (lower.exposure.moto_lane_km ?? 0)
    : 0;
  const fastLane = fastest.exposure?.moto_lane_km ?? 0;

  // Percentage — guard divide-by-zero.
  if (fastHigh > 0) {
    const pct = Math.round((fastHigh - lowHigh) / fastHigh * 100);
    els.headlinePct.textContent = pct + "%";
    els.headlinePctWrap.hidden = false;
  } else {
    els.headlinePctWrap.hidden = true;
  }

  // Extra minutes.
  const extra = (lower.duration_min ?? 0) - (fastest.duration_min ?? 0);
  els.headlineMin.textContent = (extra >= 0 ? "+" : "") + extra + " min";

  // Lane km + comparison vs fastest.
  els.headlineLane.textContent = lowLane.toFixed(1) + " km";
  els.headlineLaneVs.textContent = "(vs " + fastLane.toFixed(1) + " km)";

  els.headline.hidden = false;
}

function renderResults(data) {
  els.routeCards.innerHTML = "";
  els.reasons.innerHTML = "";

  const routes = data.routes || [];
  routes.forEach((route) => {
    els.routeCards.appendChild(renderRouteCard(route));
    drawRoute(route);
  });

  renderHeadline(routes);

  const cmp = data.comparison || {};
  (cmp.reasons || []).forEach((reason) => {
    const li = document.createElement("li");
    li.textContent = reason;
    els.reasons.appendChild(li);
  });

  els.routesPanel.hidden = false;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.routesPanel.hidden = true;
  els.headline.hidden = true;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}

function showFallbackNotice() {
  els.fallbackNotice.hidden = false;
}

function hideFallbackNotice() {
  els.fallbackNotice.hidden = true;
}

/* --- Nominatim geocoding + autocomplete --- */

// Nominatim requires a descriptive User-Agent. Browser fetch doesn't allow
// setting User-Agent directly (it's a forbidden header), so we rely on the
// default browser UA which includes the app origin. Nominatim's policy
// accepts this for low-volume client-side usage.
async function geocode(query) {
  const url =
    `${NOMINATIM_URL}?format=json&limit=5&countrycodes=my` +
    `&viewbox=${NOMINATIM_VIEWBOX}&bounded=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function renderSearchResults(listEl, results, onSelect) {
  listEl.innerHTML = "";
  if (results.length === 0) {
    listEl.hidden = true;
    return;
  }
  results.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r.display_name;
    li.addEventListener("click", () => {
      onSelect(r);
      listEl.hidden = true;
    });
    listEl.appendChild(li);
  });
  listEl.hidden = false;
}

function hideSearchResults(listEl) {
  listEl.innerHTML = "";
  listEl.hidden = true;
}

function inRouteBbox(lat, lon) {
  return (
    lat >= ROUTE_BBOX.south && lat <= ROUTE_BBOX.north &&
    lon >= ROUTE_BBOX.west && lon <= ROUTE_BBOX.east
  );
}

function selectOrigin(r) {
  state.origin = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name };
  els.originInput.value = r.display_name.split(",")[0];
  els.originResolved.textContent = r.display_name;
  els.originResolved.hidden = false;
}

function selectDest(r) {
  state.dest = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name };
  els.destInput.value = r.display_name.split(",")[0];
  els.destResolved.textContent = r.display_name;
  els.destResolved.hidden = false;
}

// Debounced search handlers (400ms).
const debouncedOriginSearch = debounce(async (q) => {
  if (q.trim().length < 2) { hideSearchResults(els.originResults); return; }
  const results = await geocode(q);
  renderSearchResults(els.originResults, results, selectOrigin);
}, 400);

const debouncedDestSearch = debounce(async (q) => {
  if (q.trim().length < 2) { hideSearchResults(els.destResults); return; }
  const results = await geocode(q);
  renderSearchResults(els.destResults, results, selectDest);
}, 400);

/* --- Live routing --- */

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function loadLiveRoute() {
  // Geocode the current input values if no selection has been made yet.
  let origin = state.origin;
  let dest = state.dest;

  // If the user typed but didn't pick from the dropdown, try to geocode now.
  if (!origin && els.originInput.value.trim()) {
    const results = await geocode(els.originInput.value);
    if (results.length === 0) {
      showError("Location not found \u2014 try a nearby landmark");
      return;
    }
    selectOrigin(results[0]);
    origin = state.origin;
  }
  if (!dest && els.destInput.value.trim()) {
    const results = await geocode(els.destInput.value);
    if (results.length === 0) {
      showError("Location not found \u2014 try a nearby landmark");
      return;
    }
    selectDest(results[0]);
    dest = state.dest;
  }

  if (!origin || !dest) {
    showError("Enter an origin and destination.");
    return;
  }

  // Bbox guard — friendly message, not a raw API error.
  if (!inRouteBbox(origin.lat, origin.lon)) {
    showError("Outside our current coverage area (Klang Valley corridor)");
    return;
  }
  if (!inRouteBbox(dest.lat, dest.lon)) {
    showError("Outside our current coverage area (Klang Valley corridor)");
    return;
  }

  clearRoutes();
  clearError();
  hideFallbackNotice();
  els.routesPanel.hidden = true;
  els.headline.hidden = true;
  els.loading.hidden = false;
  els.routeBtn.disabled = true;

  const url =
    `${API_BASE}/route?olat=${origin.lat}&olon=${origin.lon}` +
    `&dlat=${dest.lat}&dlon=${dest.lon}&night=${state.timeOfDay === "night"}`;

  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    const data = await res.json();
    state.mode = "live";
    renderResults(data);
    fitToRoutes(data.routes || []);
  } catch (err) {
    // Fallback to precomputed corridor data.
    state.mode = "static";
    showFallbackNotice();
    await loadCorridorData();
  } finally {
    els.loading.hidden = true;
    els.routeBtn.disabled = false;
  }
}

async function loadCorridorData() {
  clearRoutes();
  clearError();
  els.routesPanel.hidden = true;
  els.headline.hidden = true;
  els.loading.hidden = false;
  state.mode = "static";

  const url = `data/${state.corridorId}_${state.timeOfDay}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showError(`Could not load ${url} (HTTP ${res.status}). No route data available for this corridor and time.`);
      return;
    }
    const data = await res.json();
    renderResults(data);
    fitToRoutes(data.routes || []);
  } catch (err) {
    showError(`Failed to load route data: ${err.message}`);
  } finally {
    els.loading.hidden = true;
  }
}

function populateCorridorDropdown() {
  els.corridorSelect.innerHTML = "";
  state.corridors.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    els.corridorSelect.appendChild(opt);
  });
  els.corridorSelect.disabled = state.corridors.length === 0;
}

function setActiveTimeButton(time) {
  state.timeOfDay = time;
  els.timeToggle.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.time === time);
  });
  // Night explanation (item 4) — only when Night is active.
  els.nightNote.hidden = (time !== "night");
}

function bindEvents() {
  els.corridorSelect.addEventListener("change", () => {
    state.corridorId = els.corridorSelect.value;
    hideFallbackNotice();
    loadCorridorData();
  });

  els.routeBtn.addEventListener("click", () => {
    loadLiveRoute();
  });

  // Origin autocomplete — debounced search + clear selection on edit.
  els.originInput.addEventListener("input", () => {
    state.origin = null;
    els.originResolved.hidden = true;
    debouncedOriginSearch(els.originInput.value);
  });
  els.originInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      hideSearchResults(els.originResults);
      loadLiveRoute();
    }
  });

  // Destination autocomplete.
  els.destInput.addEventListener("input", () => {
    state.dest = null;
    els.destResolved.hidden = true;
    debouncedDestSearch(els.destInput.value);
  });
  els.destInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      hideSearchResults(els.destResults);
      loadLiveRoute();
    }
  });

  // Click outside closes the search dropdowns.
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#origin-input") && !e.target.closest("#origin-results")) {
      hideSearchResults(els.originResults);
    }
    if (!e.target.closest("#dest-input") && !e.target.closest("#dest-results")) {
      hideSearchResults(els.destResults);
    }
  });

  els.timeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    const time = btn.dataset.time;
    if (time === state.timeOfDay) return;
    setActiveTimeButton(time);
    // In live mode, re-fetch from the API with the new day/night flag.
    // In static mode, reload the precomputed JSON.
    if (state.mode === "live") {
      loadLiveRoute();
    } else {
      loadCorridorData();
    }
  });

  // Methodology expand/collapse (item 5).
  els.methodologyToggle.addEventListener("click", () => {
    const open = els.methodologyBody.hidden;
    els.methodologyBody.hidden = !open;
    els.methodologyToggle.setAttribute("aria-expanded", String(open));
  });
}

async function bootstrap() {
  initMap();
  bindEvents();

  // Pre-geocode the prefilled place names so the demo needs no typing.
  // These run in parallel; if they fail, the user can still type to search.
  try {
    const [origResults, destResults] = await Promise.all([
      geocode(els.originInput.value),
      geocode(els.destInput.value),
    ]);
    if (origResults.length > 0) selectOrigin(origResults[0]);
    if (destResults.length > 0) selectDest(destResults[0]);
  } catch (err) {
    // Non-fatal — the inputs are still usable for manual search.
  }

  try {
    const res = await fetch("data/corridors.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.corridors = data.corridors || [];
    populateCorridorDropdown();
    if (state.corridors.length === 0) {
      showError("No corridors are configured in corridors.json.");
      return;
    }
    state.corridorId = state.corridors[0].id;
    els.corridorSelect.value = state.corridorId;
    await loadCorridorData();
  } catch (err) {
    showError(`Failed to load corridors: ${err.message}`);
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
