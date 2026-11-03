"""
Kainterra – UST Food Trip Navigator (Flask web app).

Run:   python app.py     then open http://127.0.0.1:5000

The page (templates/index.html + static/js/app.js) is a single-page app: it
never reloads. Everything dynamic goes through these JSON endpoints:

    GET  /api/places   ?type=&budget=        food places + count per food type
    POST /api/route    {start, place_id | destination, profile, unit}
    GET  /api/search   ?q=                   places near UST   (GraphHopper Geocoding)
    GET  /api/reverse  ?point=lat,lng        name of a point   (GraphHopper reverse geocoding)

Every response is JSON. Errors look like {"error": "message"} and use a matching
HTTP status: 400 = bad input, 404 = not found, 429 = rate limit, 502-504 = GraphHopper problem.
"""

import re

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

import food_places
import routing_api
from routing_api import GraphHopperError

app = Flask(__name__)
app.json.ensure_ascii = False  # send "₱" as-is instead of "₱"
app.json.sort_keys = False

# "lat,lng" such as 14.6096,120.9894 (spaces allowed around the comma)
LATLNG = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


class InputError(ValueError):
    """The browser sent something invalid. Answered with HTTP 400."""


def parse_point(text, what="location"):
    """Check a "lat,lng" string and return it normalized to 6 decimals."""
    match = LATLNG.match(text) if isinstance(text, str) else None
    if not match:
        raise InputError(f"The {what} must be in lat,lng format, e.g. 14.6096,120.9894.")
    lat, lng = float(match[1]), float(match[2])
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise InputError(f"The {what} is not a real place: latitude must be -90 to 90 "
                         "and longitude -180 to 180.")
    return f"{lat:.6f},{lng:.6f}"


# ---------------------------------------------------------------- page

@app.get("/")
def index():
    """The single page. Settings the JavaScript needs are passed in as JSON."""
    config = {
        "ust": {"name": food_places.UST_NAME, "location": food_places.UST_LOCATION},
        "types": food_places.get_food_types(),
        "budgets": food_places.BUDGET_RANGES,
        "profiles": list(routing_api.PROFILES.items()),  # list keeps the Walk/Bike/Drive order
        "units": list(routing_api.UNITS),
        "has_key": routing_api.has_key(),
    }
    return render_template("index.html", config=config)


# ---------------------------------------------------------------- JSON API

@app.get("/api/places")
def api_places():
    """Food places matching the filters, plus how many places each food type has."""
    food_type = request.args.get("type") or None
    budget = request.args.get("budget") or None
    if food_type and food_type not in food_places.get_food_types():
        raise InputError(f"Unknown food type: {food_type}.")
    if budget and budget not in food_places.BUDGET_RANGES:
        raise InputError(f"Unknown budget: {budget}.")

    places = food_places.filter_places(food_type=food_type, budget=budget)

    # counts per type use the budget filter only, so the chips show what each tap would give
    counts = {t: 0 for t in food_places.get_food_types()}
    for place in food_places.filter_places(budget=budget):
        counts[place["type"]] += 1

    return jsonify(places=places, counts=counts, total=len(places))


@app.post("/api/route")
def api_route():
    """
    Directions from a start point to a food place (place_id) or any point (destination).
    Body: {"start": "lat,lng" (optional, default UST), "place_id": "...",
           "destination": "lat,lng", "profile": "foot|bike|car", "unit": "km|mi"}
    """
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise InputError("Send the trip details as JSON.")

    profile = body.get("profile", "foot")
    unit = body.get("unit", "km")
    if profile not in routing_api.PROFILES:
        raise InputError("Route type must be walk (foot), bike or drive (car).")
    if unit not in routing_api.UNITS:
        raise InputError("Unit must be km or mi.")

    start = parse_point(body.get("start") or food_places.UST_LOCATION, "starting point")

    if body.get("place_id"):
        place = food_places.get_place(body["place_id"])
        if place is None:
            raise InputError("That food place isn't on our list.")
        destination = parse_point(place["location"], "destination")
    else:
        destination = parse_point(body.get("destination"), "destination")

    if start == destination:
        raise InputError("The start and destination are the same spot. You're already there!")

    return jsonify(routing_api.get_route(start, destination, profile, unit))


@app.get("/api/search")
def api_search():
    """Search any place near UST by name (for the search bar)."""
    query = request.args.get("q", "").strip()
    if len(query) < 2:
        raise InputError("Type at least 2 characters to search.")
    if len(query) > 100:
        raise InputError("Search text is too long (100 characters max).")
    return jsonify(routing_api.search_places(query, near=food_places.UST_LOCATION))


@app.get("/api/reverse")
def api_reverse():
    """Name of the place at a point (used after picking a start on the map)."""
    point = parse_point(request.args.get("point"), "point")
    return jsonify(routing_api.reverse_geocode(point))


# ---------------------------------------------------------------- errors as JSON

@app.errorhandler(InputError)
def handle_input_error(error):
    return jsonify(error=str(error)), 400


@app.errorhandler(GraphHopperError)
def handle_graphhopper_error(error):
    return jsonify(error=error.message), error.status


@app.errorhandler(HTTPException)
def handle_http_error(error):
    """404/405 etc. answer in JSON for /api/ paths, as normal pages everywhere else."""
    if request.path.startswith("/api/"):
        return jsonify(error=error.description), error.code
    return error


@app.errorhandler(Exception)
def handle_unexpected(error):
    if isinstance(error, HTTPException):
        return handle_http_error(error)
    app.logger.exception("Unexpected error")
    return jsonify(error="Something went wrong on the server. Check the terminal for details."), 500


if __name__ == "__main__":
    # debug=True reloads the server when you save a .py file; turn it off when deploying
    app.run(debug=True)
