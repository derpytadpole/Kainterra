"""
GraphHopper API calls for Kainterra.

get_route()      - directions (Route API)
search_places()  - search places by name (Geocoding API)

All the API stuff is in this file only, so if we change APIs later
we only need to edit this file. Docs: https://docs.graphhopper.com/
The key is read from GRAPHHOPPER_KEY in the .env file.
"""

import math
import os

import requests
from dotenv import load_dotenv

load_dotenv()

ROUTE_URL = "https://graphhopper.com/api/1/route"
GEOCODE_URL = "https://graphhopper.com/api/1/geocode"
TIMEOUT_SECONDS = 15

# graphhopper returns meters, divide by these to get km or miles
METERS_PER_UNIT = {"k": 1000, "m": 1609.344}

# our own error messages for common status codes
STATUS_MESSAGES = {
    400: "Invalid request - check that both locations are valid lat,lng points.",
    401: "Invalid or missing API key - check GRAPHHOPPER_KEY in your .env file.",
    429: "API request limit reached - wait a minute and try again.",
    500: "GraphHopper server error - try again later.",
}


def format_duration(milliseconds):
    """Milliseconds to HH:MM:SS."""
    seconds = int(milliseconds // 1000)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def distance_km(a, b):
    """Straight line distance in km between two "lat,lng" points (haversine)."""
    lat1, lng1 = map(math.radians, map(float, a.split(",")))
    lat2, lng2 = map(math.radians, map(float, b.split(",")))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(h))


def call_graphhopper(url, params):
    """
    GET request to graphhopper with our key added.
    Returns (data, None) if ok, or (None, error message) if not.
    """
    key = os.getenv("GRAPHHOPPER_KEY")
    if not key:
        return None, "No API key found - add GRAPHHOPPER_KEY to your .env file."

    try:
        response = requests.get(url, params=params + [("key", key)], timeout=TIMEOUT_SECONDS)
    except requests.exceptions.Timeout:
        return None, "GraphHopper took too long to respond. Try again."
    except requests.exceptions.ConnectionError:
        return None, "Could not connect to GraphHopper. Check your internet connection."

    try:
        data = response.json()
    except ValueError:
        return None, f"Unexpected response from GraphHopper (HTTP {response.status_code})."

    if response.status_code != 200:
        # use the api's message if it has one, if not use ours
        detail = data.get("message") or STATUS_MESSAGES.get(response.status_code, "Unknown error.")
        return None, f"HTTP {response.status_code}: {detail}"

    return data, None


def get_route(start, destination, unit="k", route_type="foot"):
    """
    Get the route between two "lat,lng" points.

    unit: "k" (km) or "m" (miles)
    route_type: "car", "foot" or "bike"

    Returns {"distance", "time", "steps", "points"} or {"error": ...}
    steps = list of {"narrative", "distance"}, points = route line for the map
    """
    # params is a list because "point" is used twice (start then destination)
    data, error = call_graphhopper(ROUTE_URL, [
        ("point", start),
        ("point", destination),
        ("profile", route_type),
        ("locale", "en"),
        ("instructions", "true"),
        ("points_encoded", "false"),  # so we get normal coordinates for drawing the line
    ])
    if error:
        return {"error": error}

    if not data.get("paths"):
        return {"error": "No route found between these locations."}

    path = data["paths"][0]
    per_unit = METERS_PER_UNIT.get(unit, 1000)
    return {
        "distance": path["distance"] / per_unit,
        "time": format_duration(path["time"]),
        "steps": [
            {"narrative": step["text"], "distance": step["distance"] / per_unit}
            for step in path.get("instructions", [])
        ],
        # graphhopper gives [lng, lat] but leaflet needs [lat, lng]
        "points": [[lat, lng] for lng, lat in path["points"]["coordinates"]],
    }


def search_places(query, near, limit=8, max_km=5):
    """
    Search places by name (ex. "tapsilogan") near a "lat,lng" point.

    The api sometimes returns places in other countries, so we only keep
    the ones within max_km and sort them by distance.

    Returns {"results": [...]} or {"error": ...}
    each result has name, address, location, kind, distance_km
    """
    data, error = call_graphhopper(GEOCODE_URL, [
        ("q", query),
        ("point", near),  # prefer results near this point
        ("locale", "en"),
        ("limit", "10"),  # free plan only allows up to 10
    ])
    if error:
        return {"error": error}

    results = []
    for hit in data.get("hits", []):
        location = f"{hit['point']['lat']},{hit['point']['lng']}"
        km = distance_km(near, location)
        if km > max_km:
            continue
        street = " ".join(filter(None, [hit.get("housenumber"), hit.get("street")]))
        results.append({
            "name": hit.get("name") or street or "Unnamed place",
            "address": ", ".join(filter(None, [street, hit.get("city")])),
            "location": location,
            "kind": (hit.get("osm_value") or "").replace("_", " "),
            "distance_km": round(km, 2),
        })

    results.sort(key=lambda r: r["distance_km"])
    return {"results": results[:limit]}
