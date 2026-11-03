"""
Scan the area around UST for food places and save them to data/food_places.json.

    python scan_places.py            # 1 km around UST (default)
    python scan_places.py 1500       # custom radius in meters

Data comes from OpenStreetMap through the Overpass API (free, no key needed).
Every place is sorted into a food type from its name and OpenStreetMap tags,
and gets an estimated budget for that type. food_places.py loads the file,
so after scanning just restart the app.

Names and coordinates: © OpenStreetMap contributors (ODbL).
"""

import json
import math
import re
import sys
from pathlib import Path

import requests

UST = (14.6096, 120.9894)
OUTPUT = Path(__file__).parent / "data" / "food_places.json"

# Overpass servers; if one is busy we try the next one.
SERVERS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """
[out:json][timeout:90];
(
  nwr(around:{r},{lat},{lng})["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|bbq)$"];
  nwr(around:{r},{lat},{lng})["shop"~"^(bakery|pastry|confectionery|deli|tea|coffee)$"];
);
out center tags;
"""

# (food type, regex on the name, regex on OSM tags "amenity shop cuisine") - first match wins.
RULES = [
    ("Silog",           r"silog|silugan|tapsi|tapa\b|longsi|tocilog", r""),
    ("Dimsum & Siomai", r"dim ?sum|siomai|siopao|dumpling|xiao ?long|hakaw", r"dumpling|dim_sum"),
    ("Pares & Noodles", r"pares|mami|lomi|noodle|pancit|lugaw|goto|arroz|batchoy|ramen|mi(e|ki)\b", r"noodle|ramen|pancit"),
    ("Grill",           r"ihaw|inasal|bbq|barbe|grill|lechon|liempo", r"barbecue|grill|bbq"),
    ("Street Food",     r"turon|fishball|kwek|banana ?cue|takoyaki|shawarma|kebab|hotdog|\bcorn\b|kakanin|puto|bibingka|pichi", r"street_food|kebab|mediterranean"),
    ("Carinderia",      r"eatery|carinderia|karinderya|lutong bahay|canteen|cafeteria|food court|kainan|turo[- ]?turo|kusina|panciteria", r"regional"),
    ("Milk Tea",        r"milk ?tea|bubble|boba|dakasi|serenitea|bigbrew|big brew|chatime|cha tuk|macao imperial|tea\b|zus tea|gong ?cha|coco\b", r"bubble_tea|milk_tea|shop:tea"),
    ("Coffee",          r"coffee|cafe|café|kape|starbucks|kopi|brew|espresso|tim hortons|seattle", r"coffee"),
    ("Desserts",        r"donut|dunkin|krispy|cake|dessert|halo|ice ?cream|gelato|scoop|waffle|crepe|sweet|churro|leche", r"ice_cream|dessert|donut|cake|confectionery|pastry"),
    ("Bakery",          r"bake|bread|pandesal|panader|hopia|tinapay|goldilocks|red ribbon|eng bee tin|pastr", r"bakery"),
    ("Pizza",           r"pizza|shakey|yellow cab|greenwich|papa john|domino", r"pizza"),
    ("Korean",          r"samgyup|korean|seoul|kimchi|bulgogi|k-?food|tteok", r"korean"),
    ("Japanese",        r"ramen|sushi|japan|donburi|tokyo|katsu|takoyaki|yoshinoya|tempura|maki", r"japanese|sushi"),
    ("Chinese",         r"ma mon luk|chinese|lumpia|ongpin|wok|chowking|tea house|hong kong", r"chinese"),
    ("Burger",          r"burger|zark|minute burger|angel's", r"burger"),
    ("Fast Food",       r"jollibee|mcdo|mcdonald|kfc|wendy|burger king|popeyes|army navy|potato corner|chicken|wings?\b|fries|sandwich|subway",
                        r"fast_food|chicken|sandwich|american"),
    ("Filipino",        r"lutong|ulam|bulalo|sisig|kare|adobo|lechon", r"filipino"),
]

# estimated price per person for each type (team estimates, shown as "≈" on purpose in README)
BUDGET_BY_TYPE = {
    "Silog": "Under ₱150", "Dimsum & Siomai": "Under ₱150", "Pares & Noodles": "Under ₱150",
    "Grill": "Under ₱150", "Street Food": "Under ₱150", "Carinderia": "Under ₱150",
    "Milk Tea": "Under ₱150", "Bakery": "Under ₱150", "Fast Food": "Under ₱150", "Burger": "Under ₱150",
    "Coffee": "₱150-300", "Desserts": "₱150-300", "Pizza": "₱150-300", "Korean": "₱150-300",
    "Japanese": "₱150-300", "Chinese": "₱150-300", "Filipino": "₱150-300", "Restaurant": "₱150-300",
}
EXPENSIVE = r"samgyup|starbucks|shakey|pancake house|unli|buffet|vikings"

# things tagged as cafés/food that aren't places to eat
NOT_FOOD = r"internet|net ?cafe|pisonet|computer|printing|photo|xerox|laundry|mineski|gaming|esports"


def distance_m(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 6371000 * 2 * math.asin(math.sqrt(h))


def fetch(radius):
    query = QUERY.format(r=radius, lat=UST[0], lng=UST[1])
    for url in SERVERS:
        try:
            response = requests.post(url, data={"data": query}, timeout=120,
                                     headers={"User-Agent": "Kainterra UST food navigator (student project)"})
            if response.ok:
                print(f"Got data from {url}")
                return response.json()["elements"]
            print(f"{url} answered HTTP {response.status_code}, trying the next server...")
        except requests.RequestException as error:
            print(f"{url} failed ({type(error).__name__}), trying the next server...")
    sys.exit("All Overpass servers failed. Try again in a few minutes.")


def clean_name(raw):
    """OSM sometimes joins two shops: "Photo Services;Lugawan ni Carl" -> "Lugawan ni Carl"."""
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    food = [p for p in parts if not re.search(NOT_FOOD, p, re.I)]
    return (food or parts)[-1]


def classify(name, tags):
    tag_text = " ".join([tags.get("amenity", ""), "shop:" + tags.get("shop", ""), tags.get("cuisine", "")]).lower()
    # the name says more than the tags ("Jollibee" is tagged cuisine=burger), so check names first
    for food_type, name_rule, _ in RULES:
        if re.search(name_rule, name, re.I):
            return food_type
    for food_type, _, tag_rule in RULES:
        if tag_rule and re.search(tag_rule, tag_text):
            return food_type
    if tags.get("shop") in ("bakery", "pastry"):
        return "Bakery"
    if tags.get("amenity") == "cafe":
        return "Coffee"
    if tags.get("amenity") == "fast_food":
        return "Carinderia"  # unnamed-cuisine fast food near UST is almost always a small eatery
    return "Restaurant"


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main():
    radius = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    elements = fetch(radius)

    places, seen = [], set()
    for el in elements:
        tags = el.get("tags", {})
        if not tags.get("name") or re.search(NOT_FOOD, tags["name"], re.I) and ";" not in tags["name"]:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lng = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None or lng is None:
            continue

        name = clean_name(tags["name"])
        key = (name.lower(), round(lat, 4), round(lng, 4))  # same place mapped twice
        if key in seen:
            continue
        seen.add(key)

        food_type = classify(name, tags)
        budget = "Over ₱300" if re.search(EXPENSIVE, name, re.I) else BUDGET_BY_TYPE[food_type]
        street = " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")]))
        places.append({
            "id": f"{slug(name)}-{el['type'][0]}{el['id']}",
            "name": name,
            "type": food_type,
            "budget": budget,
            "address": ", ".join(filter(None, [street, tags.get("addr:city") or "Manila"])),
            "location": f"{lat:.6f},{lng:.6f}",
            "source": "osm",
            "distance_m": round(distance_m(UST, (lat, lng))),
        })

    places.sort(key=lambda p: p["distance_m"])
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "attribution": "© OpenStreetMap contributors (ODbL). Budgets are estimates by food type.",
        "center": f"{UST[0]},{UST[1]}",
        "radius_m": radius,
        "places": places,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = {}
    for p in places:
        counts[p["type"]] = counts.get(p["type"], 0) + 1
    print(f"Saved {len(places)} places within {radius} m to {OUTPUT}")
    for food_type, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {food_type:16} {n}")


if __name__ == "__main__":
    main()
