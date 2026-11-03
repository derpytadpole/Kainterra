"""
Food places near UST and the filter functions.

Two sources:
  1. FOOD_PLACES below - the team's own picks, with checked prices
  2. data/food_places.json - every food spot within 1 km of UST, made by
     scan_places.py from OpenStreetMap (budgets estimated from the food type)

Names, streets and coordinates are from OpenStreetMap
(© OpenStreetMap contributors). Prices are only our estimates.

To add a place: add a dictionary to FOOD_PLACES with name, type, budget,
address and location ("lat,lng"). New food types show up on the page automatically.
"""

import json
import math
import re
from pathlib import Path

UST_NAME = "University of Santo Tomas"

# default start point (UST)
UST_LOCATION = "14.6096,120.9894"

# price per person, every place's "budget" should be one of these
BUDGET_RANGES = ["Under ₱150", "₱150-300", "Over ₱300"]

# location is "lat,lng" because it works better for routing than addresses
FOOD_PLACES = [
    # Filipino favorites
    {"name": "Mang Inasal", "type": "Grill", "budget": "Under ₱150",
     "address": "Dapitan Street, Sampaloc, Manila", "location": "14.612525,120.989055"},
    {"name": "John Ken's Tapsilogan", "type": "Silog", "budget": "Under ₱150",
     "address": "1418 Laon Laan Street, Sampaloc, Manila", "location": "14.612597,120.987401"},
    {"name": "Darling's Canteen", "type": "Carinderia", "budget": "Under ₱150",
     "address": "J. Barlin Street, Sampaloc, Manila", "location": "14.608492,120.986822"},

    # Fast food
    {"name": "Jollibee", "type": "Fast Food", "budget": "Under ₱150",
     "address": "España Boulevard, Sampaloc, Manila", "location": "14.608320,120.991562"},
    {"name": "McDonald's", "type": "Fast Food", "budget": "Under ₱150",
     "address": "Padre Noval Street, Sampaloc, Manila", "location": "14.608432,120.987579"},
    {"name": "KFC", "type": "Fast Food", "budget": "₱150-300",
     "address": "Dapitan Street, Sampaloc, Manila", "location": "14.611974,120.988547"},

    # Burgers
    {"name": "45 Burger", "type": "Burger", "budget": "₱150-300",
     "address": "Padre Noval Street, Sampaloc, Manila", "location": "14.609640,120.986462"},
    {"name": "Callows Burger", "type": "Burger", "budget": "Under ₱150",
     "address": "Dapitan Street, Sampaloc, Manila", "location": "14.613741,120.990676"},

    # Pizza
    {"name": "Shakey's", "type": "Pizza", "budget": "Over ₱300",
     "address": "España Boulevard, Sampaloc, Manila", "location": "14.607574,120.990765"},
    {"name": "Yellow Cab Pizza", "type": "Pizza", "budget": "₱150-300",
     "address": "España Boulevard, Sampaloc, Manila", "location": "14.609353,120.992771"},

    # Korean
    {"name": "SamgyupSalamat", "type": "Korean", "budget": "Over ₱300",
     "address": "Asturias Street, Sampaloc, Manila", "location": "14.612288,120.987262"},
    {"name": "Kkulhyanggi", "type": "Korean", "budget": "₱150-300",
     "address": "Dapitan Street, Sampaloc, Manila", "location": "14.612149,120.988711"},

    # Japanese
    {"name": "Hashi Donburi", "type": "Japanese", "budget": "₱150-300",
     "address": "Dapitan Street, Sampaloc, Manila", "location": "14.613692,120.990427"},

    # Coffee
    {"name": "Starbucks", "type": "Coffee", "budget": "Over ₱300",
     "address": "Padre Noval Street, Sampaloc, Manila", "location": "14.606977,120.989026"},
    {"name": "Calle Cafe by Don Gabriel", "type": "Coffee", "budget": "₱150-300",
     "address": "Padre Noval Street, Sampaloc, Manila", "location": "14.606595,120.989655"},
    {"name": "ZUS Coffee", "type": "Coffee", "budget": "₱150-300",
     "address": "A. H. Lacson Avenue, Sampaloc, Manila", "location": "14.612659,120.990209"},

    # Milk tea
    {"name": "Serenitea", "type": "Milk Tea", "budget": "₱150-300",
     "address": "A. H. Lacson Avenue, Sampaloc, Manila", "location": "14.612946,120.989402"},
    {"name": "BigBrew Dapitan", "type": "Milk Tea", "budget": "Under ₱150",
     "address": "Carola Street, Sampaloc, Manila", "location": "14.613885,120.990380"},
]


def _slug(name):
    """"John Ken's Tapsilogan" -> "john-ken-s-tapsilogan" (used as a stable id in URLs)."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# give every place an id the web page can send back (e.g. in /api/route)
for _place in FOOD_PLACES:
    _place["id"] = _slug(_place["name"])
    _place["source"] = "team"


# ---------------------------------------------------------------- scanned places
# data/food_places.json is made by scan_places.py (every food spot around UST
# from OpenStreetMap). The team's own entries above win when both have the same place.

SCAN_FILE = Path(__file__).parent / "data" / "food_places.json"


def _close(a, b, meters=150):
    """True if two "lat,lng" points are within `meters` of each other (good enough at this scale)."""
    (lat1, lng1), (lat2, lng2) = (map(float, p.split(",")) for p in (a, b))
    return math.hypot((lat1 - lat2) * 111_320, (lng1 - lng2) * 107_800) <= meters


def _load_scanned():
    if not SCAN_FILE.exists():
        return []
    try:
        scanned = json.loads(SCAN_FILE.read_text(encoding="utf-8"))["places"]
    except (ValueError, KeyError):
        print(f"Warning: {SCAN_FILE} is not valid, run scan_places.py again.")
        return []
    team = {(_slug(p["name"]), p["location"]) for p in FOOD_PLACES}
    keep = []
    for place in scanned:
        if place.get("budget") not in BUDGET_RANGES:
            continue
        if any(slug == _slug(place["name"]) and _close(loc, place["location"]) for slug, loc in team):
            continue  # already in the team's list
        keep.append({key: place[key] for key in ("id", "name", "type", "budget", "address", "location", "source")})
    return keep


FOOD_PLACES.extend(_load_scanned())


def get_place(place_id):
    """The food place with this id, or None."""
    for place in FOOD_PLACES:
        if place["id"] == place_id:
            return place
    return None


def get_food_types():
    """All food types, sorted, no duplicates."""
    return sorted({place["type"] for place in FOOD_PLACES})


def filter_places(food_type=None, budget=None):
    """Places matching the food type and/or budget. None = don't filter."""
    results = []
    for place in FOOD_PLACES:
        if food_type and place["type"].lower() != food_type.lower():
            continue
        if budget and place["budget"] != budget:
            continue
        results.append(place)
    return results
