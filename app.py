"""
Kainterra web app (Flask).

How to run: python app.py, then open http://127.0.0.1:5000

/        main page (filters, directions form, route result)
/search  place search for the search bar, returns JSON
"""

import re

from flask import Flask, jsonify, render_template, request

import food_places
import routing_api

app = Flask(__name__)

# dropdown options (key = value we send, value = what the user sees)
BUDGETS = food_places.BUDGET_RANGES
UNITS = {"k": "km", "m": "miles"}
ROUTE_TYPES = {"foot": "Walking", "car": "Driving", "bike": "Bicycle"}  # graphhopper profiles

# checks for "lat,lng" format like 14.6096,120.9894
LATLNG = re.compile(r"^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$")


def find_place(name):
    """Find a listed food place by name. Returns None if not found."""
    for place in food_places.FOOD_PLACES:
        if place["name"] == name:
            return place
    return None


@app.route("/", methods=["GET", "POST"])
def index():
    """Main page. GET shows the filters, POST also gets the route."""
    # filters are in the url, ex. /?type=Filipino&budget=Under ₱150
    food_type = request.args.get("type") or None
    budget = request.args.get("budget") or None
    places = food_places.filter_places(food_type=food_type, budget=budget)

    # count per food type for the legend (based on the price filter only)
    type_counts = {t: 0 for t in food_places.get_food_types()}
    for p in food_places.filter_places(budget=budget):
        type_counts[p["type"]] += 1

    place = route = error = searched = None
    start = ""
    unit = "k"
    route_type = "foot"

    if request.method == "POST":
        start = request.form.get("start", "").strip()
        unit = request.form.get("unit", "k")
        route_type = request.form.get("route_type", "foot")

        # dest is filled when the user picked a place from the search bar,
        # otherwise we use the place from the dropdown
        dest = request.form.get("dest", "").strip()
        if dest:
            searched = {
                "name": request.form.get("dest_name", "").strip()[:100] or "Searched place",
                "address": request.form.get("dest_address", "").strip()[:200],
                "location": dest,
            }
            place = searched
        else:
            place = find_place(request.form.get("place"))

        # check the inputs first before calling the api
        if dest and not LATLNG.match(dest):
            error = "The searched destination has an invalid location. Search again."
        elif place is None:
            error = "Please choose a food place from the list."
        elif start and not LATLNG.match(start):
            error = "Starting point must be in lat,lng format, e.g. 14.6096,120.9894"
        elif unit not in UNITS or route_type not in ROUTE_TYPES:
            error = "Invalid unit or route type."
        else:
            result = routing_api.get_route(
                start or food_places.UST_LOCATION, place["location"], unit, route_type
            )
            if "error" in result:
                error = result["error"]
            else:
                route = result

    return render_template(
        "index.html",
        types=food_places.get_food_types(),
        type_counts=type_counts,
        budgets=BUDGETS,
        units=UNITS,
        route_types=ROUTE_TYPES,
        food_type=food_type,
        budget=budget,
        places=places,
        place=place,
        searched=searched,
        start=start,
        start_label=start or "University of Santo Tomas",
        ust_location=food_places.UST_LOCATION,
        unit=unit,
        route_type=route_type,
        route=route,
        error=error,
    )


@app.route("/search")
def search():
    """Search places near UST by name (used by the search bar)."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Type a place name to search."}), 400
    if len(query) > 100:
        return jsonify({"error": "Search text is too long (100 characters max)."}), 400
    return jsonify(routing_api.search_places(query, near=food_places.UST_LOCATION))


if __name__ == "__main__":
    # debug=True auto-reloads when we save a file, turn off when deploying
    app.run(debug=True)
