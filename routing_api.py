"""
GraphHopper API calls for Kainterra (the "API" module).

    get_route()        directions between two points    (Routing API)
    search_places()    find places near UST by name      (Geocoding API)
    reverse_geocode()  name of the place at a point      (Geocoding API, reverse=true)

Every GraphHopper request goes through this file only, so switching to a
different routing provider means editing this file and nothing else.
Docs: https://docs.graphhopper.com/

The key is read from GRAPHHOPPER_KEY in the .env file (never commit it).
On failure every function raises GraphHopperError, which has a readable
message and the HTTP status code the Flask app should answer with.
"""

import math
import os
from functools import lru_cache

import requests
from dotenv import load_dotenv

ROUTE_URL = "https://graphhopper.com/api/1/route"
GEOCODE_URL = "https://graphhopper.com/api/1/geocode"
TIMEOUT_SECONDS = 15

# GraphHopper vehicle profiles we allow (all three are on the free plan).
PROFILES = {"foot": "Walk", "bike": "Bike", "car": "Drive"}

# GraphHopper answers in meters; divide by these to get the chosen unit.
UNITS = {"km": 1000.0, "mi": 1609.344}

# Friendlier messages for common HTTP status codes from GraphHopper.
STATUS_MESSAGES = {
    400: "GraphHopper could not use these locations. Try a point closer to a road.",
    401: "The GraphHopper API key was rejected. Check GRAPHHOPPER_KEY in your .env file.",
    403: "This GraphHopper key isn't allowed to do that. Check your plan on graphhopper.com.",
    429: "GraphHopper's request limit was reached. Wait a minute and try again.",
    500: "GraphHopper had a server error. Try again later.",
}

# One shared connection pool makes repeated calls faster.
SESSION = requests.Session()


class GraphHopperError(Exception):
    """A GraphHopper call failed. `status` is the HTTP code to send to the browser."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- helpers

def _api_key():
    """Read the key from .env every time, so adding a key works without a restart."""
    load_dotenv(override=True)
    return os.getenv("GRAPHHOPPER_KEY", "").strip()


def has_key():
    """True if a real-looking key is set (not empty and not the placeholder)."""
    key = _api_key()
    return bool(key) and key != "your_key_here"


def distance_km(a, b):
    """Straight-line distance in km between two "lat,lng" strings (haversine formula)."""
    lat1, lng1 = map(math.radians, map(float, a.split(",")))
    lat2, lng2 = map(math.radians, map(float, b.split(",")))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(h))


def format_duration(milliseconds):
    """Milliseconds to a short label like "8 min" or "1 h 05 min"."""
    if milliseconds < 60_000:
        return "< 1 min"
    hours, minutes = divmod(round(milliseconds / 60_000), 60)
    return f"{hours} h {minutes:02d} min" if hours else f"{minutes} min"


def _get(url, params):
    """
    Send a GET request to GraphHopper with our key added and return the parsed JSON.
    Raises GraphHopperError with a clear message for every kind of failure.
    """
    if not has_key():
        raise GraphHopperError(
            "No GraphHopper API key yet. Add GRAPHHOPPER_KEY to your .env file "
            "(free key at graphhopper.com).", 503)

    try:
        response = SESSION.get(url, params=params + [("key", _api_key())], timeout=TIMEOUT_SECONDS)
    except requests.exceptions.Timeout:
        raise GraphHopperError("GraphHopper took too long to respond. Try again.", 504)
    except requests.exceptions.ConnectionError:
        raise GraphHopperError("Could not reach GraphHopper. Check your internet connection.", 502)
    except requests.exceptions.RequestException:
        raise GraphHopperError("The request to GraphHopper failed. Try again.", 502)

    try:
        data = response.json()
    except ValueError:
        raise GraphHopperError(
            f"GraphHopper sent an unexpected response (HTTP {response.status_code}).", 502)

    status = response.status_code
    if status == 200:
        return data

    message = data.get("message", "") if isinstance(data, dict) else ""
    if status == 400 and "Cannot find point" in message:
        detail = ("One of the points isn't near a road GraphHopper can route on. "
                  "Try a spot closer to a street.")
    elif status == 400 and message:
        detail = message  # GraphHopper's own message is specific enough here
    else:
        detail = STATUS_MESSAGES.get(status) or message or f"GraphHopper error (HTTP {status})."
    # 400 and 429 make sense to pass on; anything else is "the upstream service failed".
    raise GraphHopperError(detail, status if status in (400, 429) else 502)


# ---------------------------------------------------------------- routing

@lru_cache(maxsize=256)
def _route_path(start, destination, profile):
    """
    Raw GraphHopper path for one trip. Cached, so switching km/mi or going back to
    a place you already opened costs no extra API credits. (Errors are not cached.)
    """
    data = _get(ROUTE_URL, [
        ("point", start),            # "point" appears twice: start, then destination
        ("point", destination),
        ("profile", profile),
        ("locale", "en"),
        ("instructions", "true"),
        ("calc_points", "true"),
        ("points_encoded", "false"),  # plain [lng, lat] coordinates we can draw directly
    ])
    if not data.get("paths"):
        raise GraphHopperError("No route found between these two locations.", 404)
    return data["paths"][0]


def get_route(start, destination, profile="foot", unit="km"):
    """
    Directions between two "lat,lng" strings.

    profile: "foot", "bike" or "car"      unit: "km" or "mi"

    Returns a dict:
        distance      total distance in the chosen unit
        duration      readable travel time ("12 min")
        duration_ms   travel time in milliseconds (the page uses it for the arrival time)
        points        [[lat, lng], ...] route line for the map
        bbox          [[south, west], [north, east]] area that contains the route
        steps         [{text, distance, time_ms, sign, interval}, ...]
                      sign = turn type (GraphHopper code), interval = index range in points
    """
    path = _route_path(start, destination, profile)
    per_unit = UNITS[unit]

    # GraphHopper uses [lng, lat]; Leaflet wants [lat, lng].
    points = [[coord[1], coord[0]] for coord in path["points"]["coordinates"]]

    if "bbox" in path:
        west, south, east, north = path["bbox"]
    else:
        south, north = min(p[0] for p in points), max(p[0] for p in points)
        west, east = min(p[1] for p in points), max(p[1] for p in points)

    return {
        "profile": profile,
        "unit": unit,
        "distance": round(path["distance"] / per_unit, 3),
        "duration": format_duration(path["time"]),
        "duration_ms": path["time"],
        "points": points,
        "bbox": [[south, west], [north, east]],
        "steps": [
            {
                "text": step["text"],
                "distance": round(step["distance"] / per_unit, 3),
                "time_ms": step["time"],
                "sign": step["sign"],
                "interval": step["interval"],
            }
            for step in path.get("instructions", [])
        ],
    }


# ---------------------------------------------------------------- geocoding

def _describe(hit):
    """Turn one geocoding hit into (name, address)."""
    street = " ".join(filter(None, [hit.get("street"), hit.get("housenumber")]))
    name = hit.get("name") or street or "Unnamed place"
    address = ", ".join(filter(None, [street if street != name else "", hit.get("city")]))
    return name, address


@lru_cache(maxsize=256)
def _search(query, near):
    return _get(GEOCODE_URL, [
        ("q", query),
        ("point", near),   # prefer results near this point
        ("locale", "en"),
        ("limit", "10"),   # the free plan allows at most 10
    ])


def search_places(query, near, limit=8, max_km=5):
    """
    Search places by name (e.g. "tapsilogan") around a "lat,lng" point.

    GraphHopper sometimes returns matches in other cities or countries, so we keep
    only results within max_km of `near`, nearest first.

    Returns {"results": [{name, address, location, kind, distance_km}, ...]}
    """
    data = _search(query.strip().lower(), near)
    results = []
    for hit in data.get("hits", []):
        location = f"{hit['point']['lat']:.6f},{hit['point']['lng']:.6f}"
        km = distance_km(near, location)
        if km > max_km:
            continue
        name, address = _describe(hit)
        results.append({
            "name": name,
            "address": address,
            "location": location,
            "kind": (hit.get("osm_value") or "").replace("_", " "),
            "distance_km": round(km, 2),
        })
    results.sort(key=lambda r: r["distance_km"])
    return {"results": results[:limit]}


@lru_cache(maxsize=256)
def reverse_geocode(point):
    """
    Name of the place at a "lat,lng" point (used when the start is picked on the map).
    Returns {"name": str or None, "address": str}.
    """
    data = _get(GEOCODE_URL, [
        ("point", point),
        ("reverse", "true"),
        ("locale", "en"),
        ("limit", "1"),
    ])
    hits = data.get("hits") or []
    if not hits:
        return {"name": None, "address": ""}
    name, address = _describe(hits[0])
    return {"name": name, "address": address}
