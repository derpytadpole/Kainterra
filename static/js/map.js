// map.js - the map (Leaflet + OpenStreetMap) and the buttons on the page
// data comes from app.py through window.KAINTERRA in index.html

// data from flask
const {
  places: PLACES,          // places that match the filters
  types: TYPES,            // all food types
  typeCounts: TYPE_COUNTS, // count per type for the legend
  activeType: ACTIVE_TYPE, // current type filter, "" if all
  routePoints: ROUTE_POINTS, // route line, empty if no route yet
  selected: SELECTED,      // name of the chosen place
  searched: SEARCHED,      // place from the search bar, or null
} = window.KAINTERRA;
const UST = window.KAINTERRA.ust.split(",").map(Number);

const placeSelect = document.getElementById("place");
const startInput = document.getElementById("start");

// apply the filter right away when a dropdown changes
document.querySelectorAll("#filters select").forEach(s =>
  s.addEventListener("change", () => document.getElementById("filters").submit()));

// one color per food type
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42a5a5", "#d4a017", "#f032e6"];
const colorOf = type => PALETTE[TYPES.indexOf(type) % PALETTE.length];

// map starts at UST. scroll zoom is off on phones because scrolling the page
// would zoom the map instead
const map = L.map("map", { scrollWheelZoom: window.innerWidth > 760 }).setView(UST, 16);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// dot for each food place, click it to choose that place
PLACES.forEach(p => {
  const [lat, lng] = p.location.split(",").map(Number);
  const marker = L.circleMarker([lat, lng], {
    radius: p.name === SELECTED ? 11 : 8,
    color: "#fff", weight: 2, fillColor: colorOf(p.type), fillOpacity: 0.95,
  }).addTo(map);
  marker.bindTooltip(`${p.name} · ${p.type}`, { direction: "top", offset: [0, -6] });  // shows on hover
  marker.bindPopup(`<b>${p.name}</b><br>${p.type} · ${p.budget}<br>${p.address}`);
  marker.on("click", e => {
    L.DomEvent.stopPropagation(e);  // so it doesn't count as a map click (start pin)
    clearDest();  // remove the searched place if there is one
    if (placeSelect) placeSelect.value = p.name;
  });
});

// legend (top right). click a type to filter by it.
// closed by default on phones since the screen is small
const legend = L.control({ position: "topright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend" + (window.innerWidth <= 760 ? " collapsed" : ""));
  const total = Object.values(TYPE_COUNTS).reduce((a, b) => a + b, 0);
  const chip = (type, label, color, count) => `
    <button type="button" class="chip ${type === ACTIVE_TYPE ? "active" : ""}" data-type="${type}" ${count ? "" : "disabled"}>
      <i style="background:${color}"></i>${label}<span class="count">${count}</span>
    </button>`;
  div.innerHTML = `
    <button type="button" class="legend-toggle">Food types</button>
    <div class="legend-items">
      ${chip("", "All types", "conic-gradient(" + PALETTE.join(",") + ")", total)}
      ${TYPES.map(t => chip(t, t, colorOf(t), TYPE_COUNTS[t])).join("")}
    </div>`;

  L.DomEvent.disableClickPropagation(div);  // clicking the legend shouldn't move the start pin
  L.DomEvent.disableScrollPropagation(div);
  div.querySelector(".legend-toggle").addEventListener("click", () => div.classList.toggle("collapsed"));
  div.querySelectorAll(".chip").forEach(btn => btn.addEventListener("click", () => {
    document.getElementById("type").value = btn.dataset.type;
    document.getElementById("filters").submit();
  }));
  return div;
};
legend.addTo(map);

// start pin, UST by default. if the typed start is invalid we just put it at UST
const typed = startInput ? startInput.value.split(",").map(Number) : [];
const validTyped = typed.length === 2 && typed.every(Number.isFinite);
const startMarker = L.marker(validTyped ? typed : UST).addTo(map).bindTooltip("Start");

function setStart(lat, lng) {
  startMarker.setLatLng([lat, lng]);
  if (startInput) startInput.value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// click the map to move the start
map.on("click", e => setStart(e.latlng.lat, e.latlng.lng));

// use the browser's location
document.getElementById("use-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Your browser does not support location.");
  navigator.geolocation.getCurrentPosition(
    pos => { setStart(pos.coords.latitude, pos.coords.longitude); map.panTo(startMarker.getLatLng()); },
    () => alert("Could not get your location. Allow location access, or click the map instead."),
  );
});

// empty start = UST (app.py handles that)
document.getElementById("reset-start")?.addEventListener("click", () => {
  startMarker.setLatLng(UST);
  if (startInput) startInput.value = "";
});

// search bar: "Go here" sets the destination, "Start here" sets the start
let destMarker = null;

function setDest(r) {
  document.getElementById("dest").value = r.location;
  document.getElementById("dest_name").value = r.name;
  document.getElementById("dest_address").value = r.address || "";
  document.getElementById("dest-chip-text").textContent = r.name;
  document.getElementById("dest-chip").hidden = false;
  document.getElementById("place-wrap").hidden = true;
  const latlng = r.location.split(",").map(Number);
  if (destMarker) destMarker.setLatLng(latlng);
  else destMarker = L.circleMarker(latlng, {
    radius: 11, color: "#fff", weight: 3, fillColor: "#1f2328", fillOpacity: 1,
  }).addTo(map);
  destMarker.bindTooltip(`Destination: ${r.name}`.replace(/</g, "&lt;"), { direction: "top", offset: [0, -8] });
}

function clearDest() {
  ["dest", "dest_name", "dest_address"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("dest-chip").hidden = true;
  document.getElementById("place-wrap").hidden = false;
  if (destMarker) { destMarker.remove(); destMarker = null; }
}

document.getElementById("dest-clear").addEventListener("click", clearDest);
placeSelect?.addEventListener("change", clearDest);
if (SEARCHED) setDest(SEARCHED);  // keep it after the page reloads

const resultsBox = document.getElementById("search-results");

function showMessage(text) {
  resultsBox.innerHTML = "";
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  resultsBox.appendChild(p);
}

// using textContent instead of innerHTML so names from the api can't add html
function showResults(results) {
  resultsBox.innerHTML = "";
  results.forEach(r => {
    const row = document.createElement("div");
    row.className = "result";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("b");
    name.textContent = r.name;
    const details = document.createElement("small");
    details.textContent = [r.kind, r.address, `${r.distance_km} km from UST`].filter(Boolean).join(" · ");
    info.append(name, details);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "ghost";
    go.textContent = "Go here";
    go.addEventListener("click", () => { setDest(r); map.panTo(destMarker.getLatLng()); });

    const from = document.createElement("button");
    from.type = "button";
    from.className = "ghost";
    from.textContent = "Start here";
    from.addEventListener("click", () => {
      const [lat, lng] = r.location.split(",").map(Number);
      setStart(lat, lng);
      map.panTo([lat, lng]);
    });

    row.append(info, go, from);
    resultsBox.appendChild(row);
  });
}

document.getElementById("search-form").addEventListener("submit", async e => {
  e.preventDefault();
  const q = document.getElementById("search-q").value.trim();
  if (!q) return showMessage("Type a place name to search.");
  showMessage("Searching…");
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (data.error) showMessage(data.error);
    else if (!data.results.length) showMessage("No places found near UST. Try a different name.");
    else showResults(data.results);
  } catch {
    showMessage("Search failed. Check that the app is running and you are online.");
  }
});

// draw the route and zoom to it
if (ROUTE_POINTS.length) {
  const line = L.polyline(ROUTE_POINTS, { color: "#c99700", weight: 6, opacity: 0.9 }).addTo(map);
  map.fitBounds(line.getBounds().extend(startMarker.getLatLng()), { padding: [40, 40] });
}
