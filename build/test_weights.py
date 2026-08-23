from weights import risk_multiplier, risk_class


def test_trunk_base():
    assert risk_multiplier({"highway": "trunk"}) == 2.5


def test_trunk_with_moto_lane():
    assert risk_multiplier({"highway": "trunk", "motorcycle": "designated"}) == 0.75


def test_trunk_at_night():
    assert risk_multiplier({"highway": "trunk"}, night=True) == 3.5


def test_residential_baseline():
    assert risk_multiplier({"highway": "residential"}) == 1.0


def test_primary_flood_prone():
    assert risk_multiplier({"highway": "primary", "flood_prone": "yes"}) == 6.0


def test_cycleway_moto_lane_class():
    assert risk_class({"highway": "cycleway", "motorcycle": "designated"}) == "moto_lane"


def test_night_does_not_affect_residential():
    assert risk_multiplier({"highway": "residential"}, night=True) == 1.0


def test_flood_beats_moto_lane_in_class():
    attrs = {"highway": "service", "motorcycle": "designated", "flood_prone": "yes"}
    assert risk_class(attrs) == "flood"


def test_highway_tag_as_list():
    assert risk_multiplier({"highway": ["trunk", "primary"]}) == 2.5


def test_flood_detected_in_note():
    attrs = {"highway": "trunk", "note": "Underpass flooded as of 2024-02"}
    assert risk_multiplier(attrs) == 7.5


def test_unknown_class_uses_default():
    assert risk_multiplier({"highway": "footway"}) == 1.5


def test_moto_lane_yes_also_counts():
    assert risk_class({"highway": "path", "motorcycle": "yes"}) == "moto_lane"
