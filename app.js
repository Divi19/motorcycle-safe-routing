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

const state = {
  corridors: [],
  corridorId: null,
  timeOfDay: "day",
};

const els = {
  corridorSelect: document.getElementById("corridor-select"),
  timeToggle: document.getElementById("time-toggle"),
  map: document.getElementById("map"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  routesPanel: document.getElementById("routes-panel"),
  routeCards: document.getElementById("route-cards"),
  reasons: document.getElementById("reasons"),
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

  const stats = document.createElement("div");
  stats.className = "route-stats";
  const exp = route.exposure || {};
  const rows = [
    ["Distance", route.distance_km != null ? route.distance_km + " km" : "—"],
    ["Duration", route.duration_min != null ? route.duration_min + " min" : "—"],
    ["High-risk road", exp.high_risk_km != null ? exp.high_risk_km + " km" : "—"],
    ["Motorcycle lane", exp.moto_lane_km != null ? exp.moto_lane_km + " km" : "—"],
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
  return card;
}

function renderResults(data) {
  els.routeCards.innerHTML = "";
  els.reasons.innerHTML = "";

  (data.routes || []).forEach((route) => {
    els.routeCards.appendChild(renderRouteCard(route));
    drawRoute(route);
  });

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
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}

async function loadCorridorData() {
  clearRoutes();
  clearError();
  els.routesPanel.hidden = true;
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
