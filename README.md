# Kainterra – UST Food Trip Navigator

DEVASC Project Activity 3 (Option 1: feature enhancements of Lab 4.9.2,
"Integrate a REST API in a Python Application").

Kainterra helps users find food places near the University of Santo Tomas (UST)
and get directions to them. It reads food place data from a stored list, sends
the chosen trip to the **GraphHopper Directions API** over HTTP, parses the JSON
response, and shows the route on a single-page web app with an interactive map.

> The original lab used the MapQuest Directions API. MapQuest now requires a
> payment method to create a key, so the team switched to GraphHopper, which
> offers a free key.

## Team
- Kobe Marinduque
- Yao Acidre
- Julien Novilla
- Yuji Tashiro

GitHub collaborators: derpytadpole (repo owner), Juzzyboi, yaothesadcat, yujitashiro00

## Features
- **Single-page web app** – the page never reloads. The browser talks to the Flask
  server through a small JSON REST API (`/api/...`), and Flask talks to GraphHopper.
- **270+ food places within 1 km of UST**, from chains to silog spots, Dimsum Treats, carinderias,
  pares houses, ihaw-ihaw, bakeries and milk tea, sorted by distance from your starting point.
  18 are the team's hand-checked picks; the rest come from an OpenStreetMap scan (`scan_places.py`)
- **Live filters** – food type chips (with counts) and a budget selector update the list and map instantly
- **Live search** (GraphHopper Geocoding API) – our own places match as you type, then any place
  within 5 km of UST. Pick a result to get directions, or **Start here** to use it as the start.
  Typing `lat,lng` (e.g. `14.6096,120.9894`) also works.
- **Starting point** – UST by default, **Use my location**, **Pick on map**, drag the start pin, or search
- **Directions** (GraphHopper Routing API) – route type sent as an API parameter (Walk / Bike / Drive),
  km or miles, travel time, distance, arrival time, and numbered turn-by-turn steps with turn icons
- **Interactive map** (Leaflet + OpenStreetMap) – colored pins per food type, an animated route line,
  hover or tap a step to highlight it on the map
- **Shareable links** – `http://127.0.0.1:5000/#to=jollibee` opens straight to directions; the browser
  Back button returns to the list
- **Input validation and clear error messages** – bad coordinates, unknown place, missing/invalid key,
  rate limit, timeout, no internet
- **Responsive, minimal design** – side panel on desktop, draggable bottom sheet on phones,
  automatic light/dark mode, smooth animations (turned off if your system asks for reduced motion)
- **Saves API credits** – the server caches routes and searches, so switching km/mi or reopening a place is free

## Setup
1. Install Python 3 (tick **Add python.exe to PATH** in the installer) and the libraries:
   ```
   python -m pip install -r requirements.txt
   ```
2. Get a free API key at https://graphhopper.com (Dashboard → API Keys).
3. Copy `.env.example` to `.env` and put your key in it:
   ```
   GRAPHHOPPER_KEY=your_key_here
   ```
   `.env` is listed in `.gitignore`, so it is never uploaded. **Never commit your key.**
   Without a key the map, list and filters still work; directions and search show a message.

## Run
```
python app.py
```
Then open http://127.0.0.1:5000. Press `Ctrl+C` in the terminal to stop it.

## Refreshing the food places
```
python scan_places.py          # scan 1 km around UST
python scan_places.py 1500     # or a bigger radius in meters
```
This asks OpenStreetMap (Overpass API, no key needed) for every restaurant, fast food stall,
café, bakery and dessert shop near UST, sorts each into a food type from its name and tags,
gives it an estimated budget for that type, and saves `data/food_places.json`. Restart the app
afterwards. Places in the team's list in `food_places.py` always win over scanned duplicates.

## Code structure
```
Kainterra/
├── app.py               # Flask server: the page + JSON API, input validation
├── routing_api.py       # GraphHopper calls (route, search, reverse geocode) + caching
├── food_places.py       # Food place data and filters (team list + scanned file)
├── scan_places.py       # Scans OpenStreetMap for food places near UST
├── data/
│   └── food_places.json # Scanned places (made by scan_places.py)
├── templates/
│   └── index.html       # Page layout (Jinja template)
├── static/
│   ├── css/style.css    # Design tokens (colors at the top), layout, animations
│   └── js/app.js        # Everything the page does (map, filters, search, directions)
├── requirements.txt
├── .env.example         # Template for your API key (copy to .env)
└── README.md
```

| File | Purpose |
|---|---|
| `food_places.py` | **Data.** `FOOD_PLACES`, `UST_LOCATION`, `get_place(id)`, `get_food_types()`, `filter_places()` |
| `routing_api.py` | **API.** `get_route()`, `search_places()`, `reverse_geocode()`. Raises `GraphHopperError(message, status)` on failure |
| `app.py` | **Web server.** Serves the page and the JSON endpoints below; checks every input before calling GraphHopper |
| `templates/index.html` | **Page layout.** Settings for the JavaScript are passed in a `<script id="config">` JSON block |
| `static/js/app.js` | **Front end.** Numbered sections: helpers, server calls, map, explore view, search, start point, route view, views/history/bottom sheet, start-up |
| `static/css/style.css` | **Design.** Colors, radii and easing are tokens in `:root`; dark mode only swaps tokens |

### JSON API
| Method | Path | Input | Returns |
|---|---|---|---|
| GET | `/api/places` | `?type=Coffee&budget=₱150-300` (both optional) | `{places, counts, total}` |
| POST | `/api/route` | `{"start": "lat,lng", "place_id": "jollibee"` or `"destination": "lat,lng", "profile": "foot\|bike\|car", "unit": "km\|mi"}` | `{distance, duration, duration_ms, points, bbox, steps}` |
| GET | `/api/search` | `?q=tapsilogan` | `{results: [{name, address, location, kind, distance_km}]}` |
| GET | `/api/reverse` | `?point=14.61,120.99` | `{name, address}` |

Errors always look like `{"error": "message"}` with status 400 (bad input), 404, 429 (rate limit)
or 502–504 (GraphHopper problem). `app.py` only depends on what `routing_api.py` returns, so
switching to another routing API means changing `routing_api.py` only.

## How to continue the project
- **Add a food place:** add a dictionary to `FOOD_PLACES` in `food_places.py` with `name`, `type`,
  `budget`, `address`, and `location` (`"lat,lng"`; in Google Maps, right-click a place to copy it).
  New types appear in the filters automatically.
- **Add a route type:** add a GraphHopper profile to `PROFILES` in `routing_api.py` and an icon in `app.js`.
- **Change the design:** edit the tokens at the top of `static/css/style.css` (theme: yellow `--accent`, black `--ink`, white `--surface`).

### Backlog (future enhancements)
- Opening hours and "open now" filter
- Compare walk / bike / drive times side by side
- Favorite places saved in the browser
- More food places, loaded from a database instead of a Python list
- Multi-stop food crawls (GraphHopper supports several `point`s)

## Data sources
- Routes: [GraphHopper Directions API](https://docs.graphhopper.com/#tag/Routing-API)
- Search: [GraphHopper Geocoding API](https://docs.graphhopper.com/#tag/Geocoding-API) (free plan: at most 10 results per request)
- Map tiles, place names and coordinates: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
  Price ranges are the team's estimates (scanned places: estimated from the food type).
