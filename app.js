"use strict";

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
};

const els = {
  corridorSelect: document.getElementById("corridor-select"),
  timeToggle: document.getElementById("time-toggle"),
  nightNote: document.getElementById("night-note"),
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
}

function drawRoute(route) {
  // Each segment is drawn as its own polyline so its colour comes only from
  // segment.risk_class. Adjacent segments share endpoints, so the route reads
  // as a continuous line.
  route.segments.forEach((seg) => {
    if (!seg.coords || seg.coords.length < 2) return;
    const colour = RISK_COLOURS[seg.risk_class] || "#888";
    const polyline = L.polyline(seg.coords, {
      color: colour,
      weight: 6,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(map);
    routeLayers.push(polyline);
  });
}

function fitToRoutes(routes) {
  const allPoints = [];
  routes.forEach((r) => (r.segments || []).forEach((s) => {
    (s.coords || []).forEach((c) => allPoints.push(c));
  }));
  if (allPoints.length === 0) return;
  map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
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

async function loadCorridorData() {
  clearRoutes();
  clearError();
  els.routesPanel.hidden = true;
  els.headline.hidden = true;
  els.loading.hidden = false;

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
    loadCorridorData();
  });

  els.timeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    const time = btn.dataset.time;
    if (time === state.timeOfDay) return;
    setActiveTimeButton(time);
    loadCorridorData();
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
