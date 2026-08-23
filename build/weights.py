"""
Risk weighting for motorcycle route planning.

Cost of an edge = length_metres * risk_multiplier(edge_attrs, night)

These weights are informed judgment calibrated against published aggregates,
NOT a derivation from crash data. Published figures such as "62% of motorcycle
fatalities occur on primary roads" are confounded by exposure -- most riding
happens on primary roads. Without vehicle-kilometres-travelled by road class,
share-of-fatalities cannot be converted into a per-segment risk multiplier.

Lighting is deliberately NOT used as a per-segment attribute. Measured `lit`
coverage on major KL roads was 682 of 12,991 ways (5.3%), too sparse to use.
Darkness is handled as a global night multiplier instead.
"""

BASE = {
    "motorway": 3.0,
    "motorway_link": 3.0,
    "trunk": 2.5,
    "trunk_link": 2.5,
    "primary": 2.0,
    "primary_link": 2.0,
    "secondary": 1.5,
    "secondary_link": 1.5,
    "tertiary": 1.2,
    "tertiary_link": 1.2,
    "residential": 1.0,
    "unclassified": 1.0,
    "living_street": 1.0,
    "service": 1.0,
}

DEFAULT_BASE = 1.5

MOTO_LANE_FACTOR = 0.3      # segregated infrastructure
FLOOD_FACTOR = 3.0          # verified flood_prone tags on this corridor
NIGHT_FACTOR = 1.4          # applied only to high-speed shared carriageways
NIGHT_CLASSES = {"motorway", "motorway_link", "trunk", "trunk_link",
                 "primary", "primary_link"}

HIGH_CLASSES = {"motorway", "motorway_link", "trunk", "trunk_link"}
MEDIUM_CLASSES = {"primary", "primary_link", "secondary", "secondary_link"}


def _highway(attrs):
    """OSM highway tag may be a list when a way has been merged. Take the first."""
    h = attrs.get("highway", "")
    if isinstance(h, list):
        h = h[0] if h else ""
    return str(h)


def _is_moto_lane(attrs):
    m = attrs.get("motorcycle", "")
    if isinstance(m, list):
        return any(str(x) in ("designated", "yes") for x in m)
    return str(m) in ("designated", "yes")


def _is_flood_prone(attrs):
    if str(attrs.get("flood_prone", "")).lower() == "yes":
        return True
    note = attrs.get("note", "")
    if isinstance(note, list):
        note = " ".join(str(n) for n in note)
    return "flood" in str(note).lower()


def risk_multiplier(attrs, night=False):
    """Return the multiplier applied to edge length to get routing cost."""
    hw = _highway(attrs)
    mult = BASE.get(hw, DEFAULT_BASE)

    if _is_moto_lane(attrs):
        mult *= MOTO_LANE_FACTOR

    if _is_flood_prone(attrs):
        mult *= FLOOD_FACTOR

    if night and hw in NIGHT_CLASSES:
        mult *= NIGHT_FACTOR

    return round(mult, 6)


def risk_class(attrs):
    """
    Colour band for the frontend. Precedence:
    flood > moto_lane > road class.
    """
    if _is_flood_prone(attrs):
        return "flood"
    if _is_moto_lane(attrs):
        return "moto_lane"

    hw = _highway(attrs)
    if hw in HIGH_CLASSES:
        return "high"
    if hw in MEDIUM_CLASSES:
        return "medium"
    return "low"
