/* =========================================================================
   Kainterra front end
   One page, no reloads: everything talks to Flask's /api/* endpoints with fetch().

   Sections
     1. config, state, helpers
     2. talking to the server (api, progress bar, toasts)
     3. map (tiles, pins, start marker, route line)
     4. explore view (filters + place list)
     5. search bar
     6. starting point (my location, pick on map, drag, reset)
     7. route view (directions)
     8. views, browser history, phone bottom sheet
     9. start-up
   ========================================================================= */
(() => {
  "use strict";

  // ------------------------------------------------------------------ 1. config, state, helpers

  const CFG = JSON.parse(document.getElementById("config").textContent);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPhone = () => matchMedia("(max-width: 760px)").matches;

  // Theme is yellow/black/white, so every food type uses the ink color (black, or white in
  // dark mode); the selected place turns yellow. To color types differently again,
  // return a different CSS color per type here.
  const colorFor = () => "var(--ink)";

  const state = {
    all: [],          // every food place (for instant local search)
    places: [],       // places matching the current filters
    counts: {},       // food type -> number of places (with the budget filter applied)
    type: "",         // "" = all food types
    budget: "",       // "" = any budget
    start: { location: CFG.ust.location, label: CFG.ust.name, isDefault: true },
    dest: null,       // {id?, name, type?, budget?, address, location}
    profile: "foot",
    unit: "km",
    route: null,
    view: "explore",
    picking: false,
    activeStep: -1,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);
  const toLatLng = (loc) => loc.split(",").map(Number);
  const fmtLoc = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const LATLNG_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

  function parseLatLng(text) {
    const m = LATLNG_RE.exec(text);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? fmtLoc(lat, lng) : null;
  }

  function haversineKm(a, b) {
    const [lat1, lng1] = toLatLng(a).map((d) => (d * Math.PI) / 180);
    const [lat2, lng2] = toLatLng(b).map((d) => (d * Math.PI) / 180);
    const h = Math.sin((lat2 - lat1) / 2) ** 2 +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  /** Distance label in the chosen unit; `value` is already in km or mi. */
  function fmtDist(value, unit = state.unit) {
    if (unit === "km") return value < 1 ? `${Math.max(10, Math.round(value * 100) * 10)} m` : `${value.toFixed(1)} km`;
    return value < 0.1 ? `${Math.max(10, Math.round(value * 528) * 10)} ft` : `${value.toFixed(value < 10 ? 2 : 1)} mi`;
  }
  const kmToUnit = (km) => (state.unit === "km" ? km : km / 1.609344);

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  const ICONS = {
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    target: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/>',
    arrow: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    round: '<path d="M12 21v-6"/><circle cx="12" cy="9" r="5"/><path d="M15.5 5.5l1-2.5M17 9h2.5"/>',
    uturn: '<path d="M9 20V9a4 4 0 0 1 8 0v4M13 17l4-4 4 4"/>',
    walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l1.6-7.2L9 11l1.2-4.5h3.3l1.8 3.5 2.7 1"/><path d="M13.3 14.5L15 21"/>',
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3.5 7.5H5.5M13.5 5.5H16l1.2 3.5"/>',
    car: '<path d="M4 16.5V12l2.2-5.2A2 2 0 0 1 8 5.5h8a2 2 0 0 1 1.8 1.3L20 12v4.5"/><path d="M3.5 16.5h17M4 12h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  const icon = (name, style = "") => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${style ? ` style="${style}"` : ""}>${ICONS[name]}</svg>`;

  // ------------------------------------------------------------------ 2. talking to the server

  const progress = {
    count: 0,
    el: $("#progress"),
    start() { this.count += 1; this.el.classList.add("is-on"); },
    done() { this.count = Math.max(0, this.count - 1); if (!this.count) this.el.classList.remove("is-on"); },
  };

  /** fetch() wrapper: returns the parsed JSON or throws an Error with a readable message. */
  async function api(path, { method = "GET", body, signal } = {}) {
    progress.start();
    try {
      let res;
      try {
        res = await fetch(path, {
          method, signal,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        if (err.name === "AbortError") throw err;
        throw new Error("Can't reach the Kainterra server. Is python app.py still running?");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
      return data;
    } finally {
      progress.done();
    }
  }

  function toast(message, kind = "info", ms = 4200) {
    const el = document.createElement("div");
    el.className = `toast toast--${kind}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.textContent = message;
    $("#toasts").append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
    setTimeout(() => {
      el.classList.remove("is-in");
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  // ------------------------------------------------------------------ 3. map

  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, minZoom: 11, maxZoom: 19 })
    .setView(toLatLng(CFG.ust.location), 16.5);

  // OpenStreetMap tiles; the "basemap" CSS class mutes them (and darkens them in dark mode)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, className: "basemap",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const placeLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const highlightLayer = L.layerGroup().addTo(map);
  const markers = new Map(); // place id -> L.marker
  let startMarker = null;
  let destMarker = null;     // only for searched destinations (food places already have a pin)

  const divIcon = (html, size = 28) =>
    L.divIcon({ className: "pin-wrap", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

  /** Space the map should leave free for the panel when zooming to something. */
  function mapPadding() {
    const rect = $("#panel").getBoundingClientRect();
    const pad = 40;
    if (isPhone()) {
      return { paddingTopLeft: [pad, pad], paddingBottomRight: [pad, window.innerHeight - rect.top + pad] };
    }
    return { paddingTopLeft: [rect.right + pad, pad], paddingBottomRight: [pad + 48, pad] };
  }

  function fitTo(bounds, maxZoom = 17) {
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { ...mapPadding(), maxZoom, animate: !reduceMotion, duration: 0.8 });
  }

  function fitPlaces() {
    const pts = state.places.map((p) => toLatLng(p.location));
    pts.push(toLatLng(state.start.location));
    fitTo(L.latLngBounds(pts), 17);
  }

  function pinElement(id) {
    return markers.get(id)?.getElement()?.querySelector(".pin") || null;
  }

  function renderMarkers() {
    const visible = new Set(state.places.map((p) => p.id));
    for (const place of state.all) {
      let marker = markers.get(place.id);
      if (visible.has(place.id)) {
        if (!marker) {
          marker = L.marker(toLatLng(place.location), {
            icon: divIcon(`<span class="pin" style="--c:${colorFor(place.type)}"></span>`),
            riseOnHover: true, keyboard: false,
          })
            .bindTooltip(esc(place.name), { direction: "top", offset: [0, -10], className: "tip" })
            .on("click", () => (state.picking ? null : openPlace(place)));
          markers.set(place.id, marker);
        }
        if (!placeLayer.hasLayer(marker)) placeLayer.addLayer(marker);
      } else if (marker) {
        placeLayer.removeLayer(marker);
      }
    }
    syncSelectedPin();
  }

  function syncSelectedPin() {
    for (const [id] of markers) pinElement(id)?.classList.toggle("is-selected", state.dest?.id === id);
  }

  function renderStartMarker() {
    const latlng = toLatLng(state.start.location);
    if (!startMarker) {
      startMarker = L.marker(latlng, {
        icon: divIcon('<span class="start-pin"></span>'),
        draggable: true, zIndexOffset: 1000, autoPan: true, keyboard: false,
      })
        .bindTooltip("", { direction: "top", offset: [0, -12], className: "tip" })
        .addTo(map);
      startMarker.on("dragend", () => {
        const { lat, lng } = startMarker.getLatLng();
        setStart(fmtLoc(lat, lng), "Pinned location", { lookup: true });
      });
    } else {
      startMarker.setLatLng(latlng);
    }
    startMarker.setTooltipContent(esc(state.start.label));
  }

  function renderDestMarker() {
    if (destMarker) { destMarker.remove(); destMarker = null; }
    if (state.dest && !state.dest.id) {
      destMarker = L.marker(toLatLng(state.dest.location), {
        icon: divIcon('<span class="dest-pin"></span>', 30), zIndexOffset: 900, keyboard: false,
      }).bindTooltip(esc(state.dest.name), { direction: "top", offset: [0, -12], className: "tip" }).addTo(map);
    }
  }

  /** Draw the route and animate it "drawing itself" after the map has zoomed. */
  function drawRoute(route) {
    routeLayer.clearLayers();
    highlightLayer.clearLayers();
    const bounds = L.latLngBounds(route.bbox);

    let drawn = false;
    const draw = () => {
      if (drawn || state.route !== route) return;
      drawn = true;
      L.polyline(route.points, { className: "route-casing", weight: 9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
      const line = L.polyline(route.points, { className: "route-line", weight: 5, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
      animateLine(line);
    };
    map.once("moveend", draw);
    setTimeout(draw, 900); // in case the map didn't need to move
    fitTo(bounds, 17.5);
  }

  function animateLine(line) {
    const path = line.getElement();
    if (!path || reduceMotion) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.getBoundingClientRect(); // apply the starting state before transitioning
    path.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)";
    path.style.strokeDashoffset = "0";
    const reset = () => { path.style.transition = path.style.strokeDasharray = path.style.strokeDashoffset = ""; };
    path.addEventListener("transitionend", reset, { once: true });
    map.once("zoomstart", reset);
  }

  function clearRoute() {
    routeLayer.clearLayers();
    highlightLayer.clearLayers();
    state.route = null;
    state.activeStep = -1;
  }

  // map buttons
  $("#zoom-in").addEventListener("click", () => map.zoomIn());
  $("#zoom-out").addEventListener("click", () => map.zoomOut());
  $("#fit-btn").addEventListener("click", () => {
    if (state.view === "route" && state.route) fitTo(L.latLngBounds(state.route.bbox), 17.5);
    else fitPlaces();
  });

  // ------------------------------------------------------------------ 4. explore view

  /** Segmented control with a sliding thumb. options: [{value, label, html?}] */
  function makeSeg(el, options, current, onChange) {
    el.style.setProperty("--n", options.length);
    el.innerHTML = '<span class="seg__thumb" aria-hidden="true"></span>' + options.map((o) =>
      `<button type="button" class="seg__opt" role="radio" data-value="${esc(o.value)}" aria-label="${esc(o.label)}">${o.html || esc(o.label)}</button>`
    ).join("");
    const set = (value) => {
      const buttons = [...el.querySelectorAll(".seg__opt")];
      const idx = Math.max(0, buttons.findIndex((b) => b.dataset.value === value));
      buttons.forEach((b, i) => { b.setAttribute("aria-checked", i === idx); b.tabIndex = i === idx ? 0 : -1; });
      el.style.setProperty("--idx", idx);
    };
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg__opt");
      if (!btn || btn.getAttribute("aria-checked") === "true") return;
      set(btn.dataset.value);
      onChange(btn.dataset.value);
    });
    el.addEventListener("keydown", (e) => { // arrow keys move between options
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const buttons = [...el.querySelectorAll(".seg__opt")];
      const idx = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
      const next = buttons[(idx + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
      next.click();
      next.focus();
    });
    set(current);
    return { set };
  }

  function buildTypeChips() {
    const chips = [{ type: "", label: "All" }, ...CFG.types.map((t) => ({ type: t, label: t }))];
    $("#type-chips").innerHTML = chips.map(({ type, label }) => `
      <button type="button" class="chip" data-type="${esc(type)}" aria-pressed="false" ${type ? `style="--c:${colorFor(type)}"` : ""}>
        ${esc(label)}<span class="chip__count"></span>
      </button>`).join("");
    $("#type-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.type = chip.dataset.type === state.type ? "" : chip.dataset.type;
      updateChips();
      loadPlaces();
    });
  }

  function updateChips() {
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    for (const chip of document.querySelectorAll("#type-chips .chip")) {
      const type = chip.dataset.type;
      const count = type ? state.counts[type] ?? 0 : total;
      const active = type === state.type;
      chip.classList.toggle("is-active", active);
      chip.classList.toggle("is-empty", count === 0 && !active);
      chip.setAttribute("aria-pressed", active);
      chip.querySelector(".chip__count").textContent = count;
    }
  }

  const budgetSeg = makeSeg($("#budget-seg"),
    [{ value: "", label: "Any" }, ...CFG.budgets.map((b) => ({ value: b, label: b.replace("-", "–") }))],
    "", (value) => { state.budget = value; loadPlaces(); });

  let placesToken = 0;
  /** Ask the server for places matching the filters, then redraw the list and pins. */
  async function loadPlaces({ fit = false } = {}) {
    const token = ++placesToken;
    const qs = new URLSearchParams();
    if (state.type) qs.set("type", state.type);
    if (state.budget) qs.set("budget", state.budget);
    try {
      const data = await api(`/api/places?${qs}`);
      if (token !== placesToken) return; // a newer filter change already started
      state.places = data.places;
      state.counts = data.counts;
      if (!state.all.length) state.all = data.places;
      updateChips();
      renderList();
      renderMarkers();
      if (fit) fitPlaces();
    } catch (err) {
      if (token === placesToken) toast(err.message, "error");
    }
  }

  function renderList() {
    const list = $("#place-list");
    const items = state.places
      .map((place) => ({ place, km: haversineKm(state.start.location, place.location) }))
      .sort((a, b) => a.km - b.km);

    $("#place-count").textContent = `${items.length} ${items.length === 1 ? "place" : "places"}`;

    if (!items.length) {
      list.innerHTML = `<li class="empty"><p>No matches.</p>
        <button type="button" class="btn-link" data-action="clear-filters">Clear filters</button></li>`;
      return;
    }
    list.innerHTML = items.map(({ place, km }, i) => `
      <li>
        <button type="button" class="card" data-id="${esc(place.id)}" style="--i:${i};--c:${colorFor(place.type)}">
          <span class="card__badge" aria-hidden="true">${esc(place.name[0])}</span>
          <span class="card__body">
            <span class="card__title">${esc(place.name)}</span>
            <span class="card__meta">${esc(place.type)} · ${esc(place.budget)}</span>
          </span>
          <span class="card__dist" title="Straight-line distance">${fmtDist(kmToUnit(km))}</span>
        </button>
      </li>`).join("");
  }

  $("#place-list").addEventListener("click", (e) => {
    if (e.target.closest("[data-action='clear-filters']")) {
      state.type = ""; state.budget = "";
      budgetSeg.set("");
      updateChips();
      loadPlaces();
      return;
    }
    const card = e.target.closest(".card");
    if (card) openPlace(state.all.find((p) => p.id === card.dataset.id));
  });

  // hovering a card highlights its pin on the map
  $("#place-list").addEventListener("mouseover", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const marker = markers.get(card.dataset.id);
    pinElement(card.dataset.id)?.classList.add("is-hover");
    marker?.openTooltip();
  });
  $("#place-list").addEventListener("mouseout", (e) => {
    const card = e.target.closest(".card");
    if (!card || card.contains(e.relatedTarget)) return;
    pinElement(card.dataset.id)?.classList.remove("is-hover");
    markers.get(card.dataset.id)?.closeTooltip();
  });

  // ------------------------------------------------------------------ 5. search bar

  const searchInput = $("#search-input");
  const resultsEl = $("#search-results");
  let resultItems = [];
  let activeResult = -1;
  let searchController = null;

  function openResults(open) {
    resultsEl.classList.toggle("is-open", open);
    searchInput.setAttribute("aria-expanded", open);
    if (!open) { activeResult = -1; searchInput.removeAttribute("aria-activedescendant"); }
  }

  /** Draw the dropdown. items have: kind ("food" | "geo" | "coord"), name, meta, location, place? */
  function renderResults(items, { loading = false, error = "", note = "" } = {}) {
    resultItems = items;
    activeResult = -1;
    const food = items.filter((it) => it.kind === "food");
    const other = items.filter((it) => it.kind !== "food");
    let i = -1;
    const row = (it) => {
      i += 1;
      const badge = it.kind === "food"
        ? `<span class="result__icon result__icon--food" style="--c:${colorFor(it.place.type)}">${esc(it.name[0])}</span>`
        : `<span class="result__icon">${icon(it.kind === "coord" ? "target" : "pin")}</span>`;
      return `<div class="result" role="option" id="result-${i}" data-i="${i}" style="--i:${i}">
          ${badge}
          <span class="result__text"><strong>${esc(it.name)}</strong><small>${esc(it.meta)}</small></span>
          <button type="button" class="result__start" data-act="start" tabindex="-1">Start</button>
        </div>`;
    };
    let html = food.map(row).join("") + other.map(row).join("");
    if (loading) html += `<div class="results__note">Searching…</div>`;
    if (error) html += `<div class="results__note results__note--error">${esc(error)}</div>`;
    if (note) html += `<div class="results__note">${esc(note)}</div>`;
    if (!html) html = `<div class="results__note">No results.</div>`;
    resultsEl.innerHTML = html;
    openResults(true);
  }

  const remoteSearch = debounce(async (query, local) => {
    searchController?.abort();
    searchController = new AbortController();
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}`, { signal: searchController.signal });
      if (searchInput.value.trim() !== query) return; // user kept typing
      const remote = data.results.map((r) => ({
        kind: "geo", name: r.name, location: r.location, address: r.address,
        meta: [r.address, fmtDist(kmToUnit(r.distance_km))].filter(Boolean).join(" · "),
      }));
      renderResults([...local, ...remote]);
    } catch (err) {
      if (err.name === "AbortError" || searchInput.value.trim() !== query) return;
      renderResults(local, { error: err.message });
    }
  }, 320);

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    $("#search-clear").hidden = !query;
    if (!query) { searchController?.abort(); openResults(false); return; }

    const coord = parseLatLng(query);
    if (coord) {
      renderResults([{ kind: "coord", name: coord, meta: "", location: coord }]);
      return;
    }
    // our own food places match instantly, GraphHopper results follow
    const q = query.toLowerCase();
    const local = state.all
      .filter((p) => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ kind: "food", name: p.name, meta: `${p.type} · ${p.budget}`, location: p.location, place: p }));

    if (query.length < 2) { renderResults(local); return; }
    if (!CFG.has_key) {
      renderResults(local);
      return;
    }
    renderResults(local, { loading: true });
    remoteSearch(query, local);
  });

  function chooseResult(index, asStart = false) {
    const item = resultItems[index];
    if (!item) return;
    searchInput.value = "";
    $("#search-clear").hidden = true;
    openResults(false);
    searchInput.blur();
    if (asStart) {
      setStart(item.location, item.kind === "coord" ? "Pinned location" : item.name, { lookup: item.kind === "coord" });
      if (state.view === "explore") map.flyTo(toLatLng(item.location), 16.5, { duration: reduceMotion ? 0 : 0.8 });
    } else if (item.kind === "food") {
      openPlace(item.place);
    } else {
      openPlace({ name: item.kind === "coord" ? "Pinned destination" : item.name,
                  address: item.address || item.location, location: item.location });
    }
  }

  resultsEl.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  resultsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".result");
    if (row) chooseResult(Number(row.dataset.i), Boolean(e.target.closest("[data-act='start']")));
  });

  function setActiveResult(index) {
    const rows = [...resultsEl.querySelectorAll(".result")];
    if (!rows.length) return;
    activeResult = (index + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle("is-active", i === activeResult));
    rows[activeResult].scrollIntoView({ block: "nearest" });
    searchInput.setAttribute("aria-activedescendant", rows[activeResult].id);
  }

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveResult(activeResult + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveResult(activeResult - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (resultItems.length) chooseResult(activeResult >= 0 ? activeResult : 0, e.shiftKey);
    } else if (e.key === "Escape") {
      if (searchInput.value) { searchInput.value = ""; $("#search-clear").hidden = true; }
      openResults(false);
      searchInput.blur();
    }
  });
  searchInput.addEventListener("focus", () => {
    if (isPhone()) setSheet(true);
    if (searchInput.value.trim()) searchInput.dispatchEvent(new Event("input"));
  });
  searchInput.addEventListener("blur", () => setTimeout(() => openResults(false), 120));
  $("#search-clear").addEventListener("click", () => {
    searchInput.value = "";
    $("#search-clear").hidden = true;
    openResults(false);
    searchInput.focus();
  });

  // "/" focuses the search bar from anywhere
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === "Escape" && state.picking) setPicking(false);
  });

  // ------------------------------------------------------------------ 6. starting point

  let lookupToken = 0;
  /** Change the starting point. lookup = ask GraphHopper for a readable name afterwards. */
  async function setStart(location, label, { lookup = false, isDefault = false } = {}) {
    state.start = { location, label, isDefault };
    renderStartUI();
    renderStartMarker();
    renderList();
    if (state.view === "route" && state.dest) fetchRoute();

    if (lookup && CFG.has_key) {
      const token = ++lookupToken;
      try {
        const place = await api(`/api/reverse?point=${encodeURIComponent(location)}`);
        if (token === lookupToken && state.start.location === location && place.name) {
          state.start.label = place.name;
          renderStartUI();
          renderStartMarker();
        }
      } catch { /* the label just stays "Pinned location" */ }
    }
  }

  function renderStartUI() {
    $("#start-label").textContent = state.start.label;
    $("#start-label").title = state.start.location;
    $("#start-reset").hidden = state.start.isDefault;
    $("#trip-from").textContent = state.start.label;
    // restart the fade animation so the change is noticeable
    const label = $("#start-label");
    label.style.animation = "none";
    label.offsetWidth; // eslint-disable-line no-unused-expressions
    label.style.animation = "";
  }

  $("#start-reset").addEventListener("click", () => {
    setStart(CFG.ust.location, CFG.ust.name, { isDefault: true });
    if (state.view === "explore") map.flyTo(toLatLng(CFG.ust.location), 16.5, { duration: reduceMotion ? 0 : 0.8 });
  });

  $("#locate-btn").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("This browser can't share its location.", "error"); return; }
    const btn = $("#locate-btn");
    btn.classList.add("is-busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove("is-busy");
        const loc = fmtLoc(pos.coords.latitude, pos.coords.longitude);
        const km = haversineKm(CFG.ust.location, loc);
        if (km > 30) toast(`You're about ${Math.round(km)} km from UST, so routes will be long.`);
        setStart(loc, "Your location", { lookup: true });
        if (state.view === "explore") fitPlaces();
      },
      (err) => {
        btn.classList.remove("is-busy");
        toast(err.code === 1
          ? "Location access was blocked. You can pick a start on the map instead."
          : "Couldn't get your location. Try again, or pick a start on the map.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  function setPicking(on) {
    state.picking = on;
    document.body.classList.toggle("is-picking", on);
    $("#pick-btn").setAttribute("aria-pressed", on);
    $("#map-hint").classList.toggle("is-on", on);
    if (on && isPhone()) setSheet(false);
  }
  $("#pick-btn").addEventListener("click", () => setPicking(!state.picking));
  $("#pick-cancel").addEventListener("click", () => setPicking(false));
  map.on("click", (e) => {
    if (!state.picking) return;
    setPicking(false);
    setStart(fmtLoc(e.latlng.lat, e.latlng.lng), "Pinned location", { lookup: true });
  });

  // ------------------------------------------------------------------ 7. route view

  function openPlace(place, { pushHistory = true } = {}) {
    if (!place) return;
    state.dest = place;
    setPicking(false);
    renderDestHeader();
    renderDestMarker();
    syncSelectedPin();
    $("#map").classList.add("is-routing");
    setView("route");
    if (pushHistory) {
      const hash = place.id ? `#to=${place.id}` : `#to=${place.location}`;
      history.pushState({ route: true }, "", hash);
    }
    fetchRoute();
  }

  function renderDestHeader() {
    const d = state.dest;
    const badge = $("#dest-badge");
    badge.textContent = d.name[0];
    if (d.type) badge.style.setProperty("--c", colorFor(d.type));
    else badge.style.removeProperty("--c");
    $("#dest-name").textContent = d.name;
    $("#dest-meta").textContent = d.type ? `${d.type} · ${d.budget}` : d.address;
    $("#trip-from").textContent = state.start.label;
    $("#trip-to").textContent = d.name;
  }

  let routeToken = 0;
  /** Ask the server for directions. redraw = false keeps the line (used when only units change). */
  async function fetchRoute({ redraw = true } = {}) {
    if (!state.dest) return;
    const token = ++routeToken;
    $("#route-error").hidden = true;
    if (redraw) { clearRoute(); showRouteLoading(); }

    const body = { start: state.start.location, profile: state.profile, unit: state.unit };
    if (state.dest.id) body.place_id = state.dest.id;
    else body.destination = state.dest.location;

    try {
      const route = await api("/api/route", { method: "POST", body });
      if (token !== routeToken) return; // a newer request replaced this one
      state.route = route;
      renderRoute(route);
      if (redraw) drawRoute(route);
    } catch (err) {
      if (token !== routeToken) return;
      showRouteError(err.message);
    }
  }

  function showRouteLoading() {
    $("#route-summary").innerHTML = '<div class="sk sk--stat"></div><div class="sk sk--stat"></div><div class="sk sk--stat"></div>';
    $("#steps-title").textContent = "";
    $("#steps").innerHTML = Array.from({ length: 5 }, () => '<li class="sk sk--step"></li>').join("");
  }

  function showRouteError(message) {
    $("#route-summary").innerHTML = "";
    $("#steps").innerHTML = "";
    $("#steps-title").textContent = "";
    $("#route-error-text").textContent = message;
    $("#route-error").hidden = false;
    // still zoom to show both ends so the user sees what was asked
    fitTo(L.latLngBounds([toLatLng(state.start.location), toLatLng(state.dest.location)]));
  }
  $("#retry-btn").addEventListener("click", () => fetchRoute());

  function renderRoute(route) {
    const arrive = new Date(Date.now() + route.duration_ms)
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const decimals = route.distance < 10 ? 2 : 1;

    $("#route-summary").innerHTML = `
      <div class="stat stat--main" style="--i:0">
        <span class="stat__value">${esc(route.duration)}</span>
      </div>
      <div class="stat" style="--i:1">
        <span class="stat__value"><span data-count="${route.distance}" data-decimals="${decimals}">0</span> ${esc(route.unit)}</span>
      </div>
      <div class="stat" style="--i:2">
        <span class="stat__value">${esc(arrive)}</span>
        <span class="stat__label">ETA</span>
      </div>`;
    const counter = $("[data-count]");
    countUp(counter, Number(counter.dataset.count), Number(counter.dataset.decimals));

    $("#steps-title").textContent = "Directions";
    $("#steps").innerHTML = route.steps.map((step, i) => `
      <li>
        <button type="button" class="step" data-i="${i}" style="--i:${i}">
          <span class="step__icon">${stepIcon(step.sign)}</span>
          <span class="step__text">${esc(step.text)}</span>
          <span class="step__dist">${step.distance > 0 ? fmtDist(step.distance, route.unit) : ""}</span>
        </button>
      </li>`).join("");
    state.activeStep = -1;
  }

  function countUp(el, to, decimals) {
    if (reduceMotion) { el.textContent = to.toFixed(decimals); return; }
    const t0 = performance.now();
    const duration = 700;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      el.textContent = (to * (1 - (1 - k) ** 3)).toFixed(decimals);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Icon for a GraphHopper turn sign (https://docs.graphhopper.com/#operation/getRoute). */
  function stepIcon(sign) {
    if (sign === 4) return icon("flag");
    if (sign === 5) return icon("pin");
    if (sign === 6 || sign === -6) return icon("round");
    if (sign === -98 || sign === -8 || sign === 8) return icon("uturn");
    const angle = { "-3": -135, "-2": -90, "-1": -45, 0: 0, 1: 45, 2: 90, 3: 135, "-7": -30, 7: 30 }[sign] ?? 0;
    return icon("arrow", `transform:rotate(${angle}deg)`);
  }

  /** Points of one step, used to highlight it on the map. */
  function stepPoints(i) {
    const [from, to] = state.route.steps[i].interval;
    return state.route.points.slice(from, to + 1);
  }

  function highlightStep(i) {
    highlightLayer.clearLayers();
    if (i < 0 || !state.route) return;
    const pts = stepPoints(i);
    if (pts.length > 1) {
      L.polyline(pts, { className: "route-hl", weight: 7, lineCap: "round", interactive: false }).addTo(highlightLayer);
    }
    L.circleMarker(pts[0], { radius: 6, className: "route-hl", fillColor: "#fff", fillOpacity: 1, weight: 3, interactive: false }).addTo(highlightLayer);
  }

  const stepsEl = $("#steps");
  stepsEl.addEventListener("mouseover", (e) => {
    const step = e.target.closest(".step");
    if (step) highlightStep(Number(step.dataset.i));
  });
  stepsEl.addEventListener("mouseleave", () => highlightStep(state.activeStep));
  stepsEl.addEventListener("click", (e) => {
    const step = e.target.closest(".step");
    if (!step) return;
    const i = Number(step.dataset.i);
    state.activeStep = i;
    stepsEl.querySelectorAll(".step").forEach((s) => s.classList.toggle("is-active", s === step));
    highlightStep(i);
    const pts = stepPoints(i);
    if (pts.length > 1) fitTo(L.latLngBounds(pts).pad(0.4), 18.5);
    else map.flyTo(pts[0], 18, { duration: reduceMotion ? 0 : 0.6 });
    if (isPhone()) setSheet(false);
  });

  makeSeg($("#profile-seg"),
    CFG.profiles.map(([value, label]) => ({
      value, label, html: `${icon({ foot: "walk", bike: "bike", car: "car" }[value] || "pin")}<span>${esc(label)}</span>`,
    })),
    state.profile, (value) => { state.profile = value; fetchRoute(); });

  makeSeg($("#unit-seg"), CFG.units.map((u) => ({ value: u, label: u })), state.unit, (value) => {
    state.unit = value;
    renderList();
    fetchRoute({ redraw: false }); // same line, only the numbers change (cached on the server)
  });

  // ------------------------------------------------------------------ 8. views, history, bottom sheet

  function setView(name) {
    state.view = name;
    const explore = $("#view-explore");
    const route = $("#view-route");
    explore.classList.toggle("is-active", name === "explore");
    explore.classList.toggle("is-left", name === "route");
    route.classList.toggle("is-active", name === "route");
    if (name === "route") route.scrollTop = 0;
  }

  function closeRoute() {
    routeToken += 1; // ignore any route still loading
    state.dest = null;
    clearRoute();
    renderDestMarker();
    syncSelectedPin();
    $("#map").classList.remove("is-routing");
    setView("explore");
    fitPlaces();
  }

  $("#back-btn").addEventListener("click", () => {
    if (history.state?.route) history.back(); // popstate below closes the route
    else { history.replaceState(null, "", location.pathname); closeRoute(); }
  });
  window.addEventListener("popstate", () => {
    const dest = destFromHash();
    if (dest) openPlace(dest, { pushHistory: false });
    else if (state.view === "route") closeRoute();
  });

  /** "#to=jollibee" or "#to=14.61,120.99" -> destination object (for shared links / back button). */
  function destFromHash() {
    const m = /^#to=(.+)$/.exec(location.hash);
    if (!m) return null;
    const value = decodeURIComponent(m[1]);
    const place = state.all.find((p) => p.id === value);
    if (place) return place;
    const coord = parseLatLng(value);
    return coord ? { name: "Pinned destination", address: coord, location: coord } : null;
  }

  // phone bottom sheet: tap the handle to expand/collapse, or drag it
  const panel = $("#panel");
  const handle = $("#sheet-handle");
  function setSheet(expanded) {
    panel.classList.toggle("is-expanded", expanded);
    handle.setAttribute("aria-expanded", expanded);
    handle.setAttribute("aria-label", expanded ? "Collapse panel" : "Expand panel");
  }
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    panel.classList.add("is-dragging");
    panel.style.height = `${Math.min(window.innerHeight * 0.92, Math.max(120, drag.h - dy))}px`;
  });
  handle.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    panel.classList.remove("is-dragging");
    panel.style.height = "";
    if (!drag.moved) setSheet(!panel.classList.contains("is-expanded"));
    else setSheet(dy < 0);
    drag = null;
  });

  // tell the CSS how much of the screen the sheet covers (moves the map attribution up)
  new ResizeObserver(() => {
    const offset = isPhone() ? Math.max(0, window.innerHeight - panel.getBoundingClientRect().top) : 0;
    document.documentElement.style.setProperty("--sheet-offset", `${offset}px`);
  }).observe(panel);

  // ------------------------------------------------------------------ 9. start-up

  buildTypeChips();
  renderStartUI();
  renderStartMarker();
  loadPlaces({ fit: true }).then(() => {
    const dest = destFromHash(); // open a shared link like /#to=jollibee
    if (dest) {
      history.replaceState(null, "", location.pathname);
      openPlace(dest);
    }
  });
})();
