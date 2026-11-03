# Kainterra – UST Food Trip Navigator

DEVASC Project Activity 3 (Option 1: feature enhancements of Lab 4.9.2,
"Integrate a REST API in a Python Application").

Kainterra helps users find food places near the University of Santo Tomas (UST)
and get directions to them. It reads food place data from a stored list, sends
the chosen trip to the **GraphHopper Directions API** over HTTP, parses the JSON
response, and shows the route on a web page with an interactive map.

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
- **18 food places near UST** across 8 food types (Filipino, Fast Food, Burger, Pizza, Korean, Japanese, Coffee, Milk Tea)
- **Search bar** (GraphHopper Geocoding API): find *any* place near UST by name (e.g. "tapsilogan", "SM San Lazaro"), then use it as the destination (**Go here**) or the start (**Start here**). Only results within 5 km of UST are shown.
- **Filter** by food type and/or price per person (Under ₱150 / ₱150-300 / Over ₱300)
- **Interactive map** (Leaflet + OpenStreetMap): a marker for each food place, colored by food type; click a marker to choose that place, or hover to see its name
- **Map legend** with a count per food type; click a type to filter (collapsible, closed by default on phones)
- **Starting point:** UST by default, **Use my location** (browser geolocation), a click on the map, or a typed `lat,lng`
- **Route drawn on the map** using the route line from GraphHopper (`points_encoded=false`)
- **Route type** sent to the API as a parameter: walking, driving, or bicycle
- **Units:** kilometers or miles
- **Trip summary** (distance, travel time, mode) and numbered **turn-by-turn directions**
- **Input validation** (place, `lat,lng` format, units, route type) and **clear API error messages** (bad key, invalid point, rate limit, timeout, no internet)

## Setup
1. Install Python 3 and the libraries:
   ```
   python -m pip install -r requirements.txt
   ```
2. Get a free API key at https://graphhopper.com (Dashboard → API Keys).
3. Copy `.env.example` to `.env` and put your key in it:
   ```
   GRAPHHOPPER_KEY=your_key_here
   ```
   `.env` is listed in `.gitignore`, so it is never uploaded. **Never commit your key.**

## Run
```
python app.py
```
Then open http://127.0.0.1:5000. Press `Ctrl+C` in the terminal to stop it.

## Code structure
```
Kainterra/
├── app.py               # Flask web server (routes and input validation)
├── routing_api.py       # GraphHopper API calls (directions + search)
├── food_places.py       # Food place data and filters
├── templates/
│   └── index.html       # Page layout (Jinja template)
├── static/
│   ├── css/style.css    # Page styles
│   └── js/map.js        # Map and page behavior (Leaflet)
├── requirements.txt     # Python libraries
├── .env.example         # Template for your API key (copy to .env)
└── README.md
```

| File | Purpose |
|---|---|
| `food_places.py` | **Data.** `FOOD_PLACES` list, `UST_LOCATION`, `get_food_types()`, `filter_places()` |
| `routing_api.py` | **API.** `get_route(start, destination, unit, route_type)` calls the GraphHopper Route API and returns `{"distance", "time", "steps", "points"}`; `search_places(query, near)` calls the Geocoding API and returns nearby `{"results"}`. Both return `{"error"}` on failure |
| `app.py` | **Web interface** (Flask). `/` = filter form (GET) and directions form (POST) with input validation; `/search?q=` = JSON search results for the search bar |
| `templates/index.html` | **Page layout** (Jinja template, rendered by Flask). Passes the data to `map.js` through `window.KAINTERRA` |
| `static/css/style.css` | **Styles.** Colors are defined once at the top (`:root`) |
| `static/js/map.js` | **Map behavior** (Leaflet): food markers, legend, start pin, search results, route line |

`app.py` only depends on the format `get_route()` and `search_places()` return.
To switch to a different routing API, change only `routing_api.py`.

## How to continue the project
- **Add a food place:** add a dictionary to `FOOD_PLACES` in `food_places.py`
  with `name`, `type`, `budget`, `address`, and `location` (`"lat,lng"`; in Google
  Maps, right-click the place to copy its coordinates). New types appear in the
  filter automatically.
- **Add a route type:** add a GraphHopper profile to `ROUTE_TYPES` in `app.py`.
  Check which profiles your GraphHopper plan allows.
- **Change the design:** edit `static/css/style.css` (colors are at the top).

## Data sources
- Routes: [GraphHopper Directions API](https://docs.graphhopper.com/#tag/Routing-API)
- Search: [GraphHopper Geocoding API](https://docs.graphhopper.com/#tag/Geocoding-API) (free plan: at most 10 results per request)
- Place names and coordinates: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
  Price ranges are the team's estimates.
