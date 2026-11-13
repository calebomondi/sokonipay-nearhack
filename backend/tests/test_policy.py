from app.accounts import DEFAULT_RULES
from app import fx, policy
from app.policy import (MICRO, Line, allowed_discount, allowed_discount_bps, apply_discount, parse_goal, price_request,
                        scripted_basket, share_of, subtotal, trim_to_budget)

# A sample menu for these tests only: (sku, name, price in micro sUSD, tags, stock)
MENU = [
    ("pilau", "Beef pilau", 3_500_000, ["main", "meat"], 14),
    ("choma", "Nyama choma", 6_000_000, ["main", "meat"], 8),
    ("githeri", "Githeri bowl", 2_800_000, ["main", "veg"], 12),
    ("sukuma", "Sukuma wiki", 1_200_000, ["side", "veg"], 7),
    ("ugali", "Ugali", 800_000, ["side", "veg"], 20),
    ("chapati", "Chapati", 500_000, ["side", "veg"], 24),
    ("samosa", "Samosa pair", 1_000_000, ["side", "meat"], 16),
    ("chai", "Masala chai", 600_000, ["drink", "veg"], 30),
    ("juice", "Fresh mango juice", 1_500_000, ["drink", "veg"], 12),
    ("band-night", "Friday band night entry", 5_000_000, ["ticket"], 40),
]
ITEMS = [dict(sku=s, name=n, price=p, tags=t, stock=st) for s, n, p, t, st in MENU]


def test_parse_goal():
    # People say budgets in shillings; the agents work in micro dollars at the current rate.
    g = parse_goal("Lunch for three, vegetarian, under KES 2,580")
    assert (g.people, g.budget, g.veg, g.ticket) == (3, fx.to_micro(2580), True, False)
    assert parse_goal("one entry ticket for band night").ticket
    assert parse_goal("lunch", party_size=4).people == 4


def test_basket_fits_budget_and_diet():
    lines = scripted_basket(ITEMS, "Lunch for three, vegetarian, under 2580")
    assert lines and subtotal(lines) <= 20 * MICRO
    meat = {i["sku"] for i in ITEMS if "meat" in i["tags"]}
    assert not any(line.sku in meat for line in lines)


def test_named_items_and_quantities():
    lines = scripted_basket(ITEMS, "4 nyama choma")
    assert [(line.sku, line.qty) for line in lines] == [("choma", 4)]
    assert [line.sku for line in scripted_basket(ITEMS, "a band night ticket")] == ["band-night"]


def test_prices_come_from_the_catalog_not_the_customer():
    lines, missing = price_request(ITEMS, [{"sku": "choma", "qty": 2, "unit_price": 1}, {"sku": "lobster", "qty": 1}])
    assert lines[0].unit_price == 6 * MICRO and missing == ["lobster"]


def test_discount_is_capped_by_the_owners_rules():
    old = {"tiers": [{"min": 15_000_000, "bps": 1000}, {"min": 8_000_000, "bps": 500}], "group_bps": 1000}  # shops set up earlier
    small = [Line("chai", "Masala chai", 1, 600_000)]
    mid = [Line("pilau", "Beef pilau", 3, 3_500_000)]      # 10.50
    big = [Line("choma", "Nyama choma", 4, 6_000_000)]     # 24.00
    ticket = [Line("band-night", "Friday band night entry", 1, 5_000_000)]
    assert allowed_discount_bps(old, ITEMS, small, False) == 0
    assert allowed_discount_bps(old, ITEMS, mid, False) == 500
    assert allowed_discount_bps(old, ITEMS, mid, True) == 1000
    assert allowed_discount_bps(old, ITEMS, big, False) == 1000
    assert allowed_discount_bps(old, ITEMS, ticket, True) == 0
    assert apply_discount(24 * MICRO, 1000) == 21_600_000


def test_owner_set_discount_conditions():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    rules = {"discounts": [
        {"kind": "total", "min_kes": 1000, "percent": 5}, {"kind": "group", "people": 4, "percent": 10},
        {"kind": "time", "from": "14:00", "to": "16:00", "percent": 15}, {"kind": "returning", "visits": 3, "percent": 7.5}]}
    noon = datetime(2026, 11, 12, 12, 0, tzinfo=ZoneInfo("Africa/Nairobi"))
    three = noon.replace(hour=15)
    small, large = [Line("chai", "Masala chai", 1, fx.to_micro(80))], [Line("choma", "Nyama choma", 2, fx.to_micro(800))]
    assert allowed_discount(rules, small, now=noon) == (0, "")
    assert allowed_discount(rules, large, now=noon) == (500, "orders of KES 1,000 or more")
    assert allowed_discount(rules, small, people=4, now=noon) == (1000, "groups of 4 or more")
    assert allowed_discount(rules, small, visits=3, now=noon) == (750, "customers who have paid here 3 times or more")
    assert allowed_discount(rules, large, people=4, visits=5, now=three) == (1500, "orders between 14:00 and 16:00")  # the best one, not the sum
    assert allowed_discount({"discounts": []}, large, people=9, visits=9, now=three) == (0, "")


def test_trim_and_shares():
    lines = [Line("a", "A", 2, 3 * MICRO), Line("b", "B", 2, MICRO)]
    assert subtotal(trim_to_budget(lines, 6 * MICRO)) <= 6 * MICRO
    total = 10 * MICRO + 1
    shares = [share_of(total, 3, n) for n in range(3)]
    assert sum(shares) == total and shares[0] == shares[1]


# ---- a counter: the customer names the money, the price list decides the quantity

DIESEL = {"sku": "diesel", "name": "Diesel", "price_kes": 125, "tags": ["counter", "unit:litre"]}
BREAD = {"sku": "bread", "name": "Bread", "price_kes": 65, "tags": ["counter", "unit:loaf", "whole"]}


def test_amount_buys_a_measured_quantity():
    b = policy.amount_buys(DIESEL, 1500)
    assert b.ok and b.charge_kes == 1500 and b.what == "Diesel, 12 litres" and b.qty == 0
    assert "12 litres of Diesel at KES 125 a litre" in b.says


def test_amount_buys_whole_units_and_charges_only_for_them():
    b = policy.amount_buys(BREAD, 200)
    assert b.ok and b.qty == 3 and b.charge_kes == 195  # never the full 200 for three loaves
    assert not policy.amount_buys(BREAD, 50).ok  # less than one loaf buys nothing
    free = policy.amount_buys(None, 400, "airtime")  # nothing listed: the money goes through with a note
    assert free.ok and free.charge_kes == 400 and free.what == "airtime"


def test_ticket_sold_while_closed_is_for_the_next_opening():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Africa/Nairobi")
    hours = {"open": "06:00", "close": "18:00", "tz": "Africa/Nairobi"}
    late = policy.gate_now(hours, datetime(2026, 11, 13, 23, 40, tzinfo=tz))
    assert not late.open and late.ticket_day == "tomorrow"
    assert datetime.fromtimestamp(late.closes_at_ms / 1000, tz) == datetime(2026, 11, 14, 18, 0, tzinfo=tz)
    early = policy.gate_now(hours, datetime(2026, 11, 13, 3, 0, tzinfo=tz))
    assert not early.open and early.ticket_day == "today"
    assert datetime.fromtimestamp(early.closes_at_ms / 1000, tz) == datetime(2026, 11, 13, 18, 0, tzinfo=tz)
    assert policy.gate_now(hours, datetime(2026, 11, 13, 12, 0, tzinfo=tz)).ticket_day == ""
