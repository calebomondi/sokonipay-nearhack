"""Rules that hold no matter who is driving: a script or an LLM.

The Merchant Agent can only quote through `price_request` and `allowed_discount_bps`,
so it can never undercut the owner's rules. The Personal Agent's fallback shopping
logic lives here too. Amounts are integers in micro sUSD (6 decimals)."""

import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import fx

MICRO = 1_000_000
_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1}


@dataclass
class Line:
    sku: str
    name: str
    qty: int
    unit_price: int

    def dict(self) -> dict:
        return asdict(self)


def fmt(micro: int) -> str:
    """An amount as people read it, in shillings: KES 1,274."""
    return fx.say(micro)


def shillings(micro: int) -> int:
    return round(fx.to_kes(micro))


def subtotal(lines: list[Line]) -> int:
    return sum(line.qty * line.unit_price for line in lines)


def listing(lines: list[Line]) -> str:
    return ", ".join(f"{line.qty} × {line.name}" for line in lines)


def apply_discount(amount: int, bps: int) -> int:
    return amount - amount * bps // 10_000


# ---------------------------------------------------------------- merchant side


def is_ticket(items: list[dict], lines: list[Line]) -> bool:
    """An order is a ticket when everything in it is an entry ticket."""
    by_sku = {i["sku"]: i for i in items}
    return bool(lines) and all("ticket" in by_sku.get(line.sku, {}).get("tags", []) for line in lines)


@dataclass
class Gate:
    open: bool
    closes_at_ms: int  # when today's tickets stop working; 0 if the venue keeps no hours
    says: str


def gate_now(hours: dict | None, now: datetime | None = None) -> Gate:
    """Is the venue open, and when do today's tickets expire? Times are in the venue's own timezone."""
    if not hours or not hours.get("open") or not hours.get("close"):
        return Gate(True, 0, "")
    tz = ZoneInfo(hours.get("tz") or "Africa/Nairobi")
    now = (now or datetime.now(tz)).astimezone(tz)

    def at(hhmm: str) -> datetime:
        h, m = (int(x) for x in hhmm.split(":"))
        return now.replace(hour=h, minute=m, second=0, microsecond=0)

    opens, closes = at(hours["open"]), at(hours["close"])
    if closes <= opens:  # open past midnight
        if now < closes:
            opens -= timedelta(days=1)
        else:
            closes += timedelta(days=1)
    span = f"{hours['open']} to {hours['close']}"
    if now < opens:
        return Gate(False, 0, f"We're not open yet. Gates are open {span}.")
    if now >= closes:
        return Gate(False, 0, f"We're closed for today. Gates are open {span}.")
    return Gate(True, int(closes.timestamp() * 1000), f"Valid until {hours['close']} today.")


def hours_line(hours: dict | None) -> str:
    """Opening hours in a few words for a shop's page: 'Open now · closes 18:30'. Empty if the shop keeps none."""
    if not hours or not hours.get("open") or not hours.get("close"):
        return ""
    if hours["open"] == "00:00" and hours["close"] == "23:59":
        return "Open all day"
    g = gate_now(hours)
    if g.open:
        return f"Open now · closes {hours['close']}"
    tz = ZoneInfo(hours.get("tz") or "Africa/Nairobi")
    before = datetime.now(tz).strftime("%H:%M") < hours["open"]
    return f"Closed · opens {hours['open']}{'' if before else ' tomorrow'}"


def discount_rules(rules: dict) -> list[dict]:
    """The owner's discount conditions. Each is a ceiling the agent may go up to, never past:
      {"kind": "total", "min_kes": 1000, "percent": 5}        orders of KES 1,000 or more
      {"kind": "group", "people": 4, "percent": 10}           4 or more people (or tickets)
      {"kind": "time", "from": "14:00", "to": "16:00", "percent": 10}
      {"kind": "returning", "visits": 3, "percent": 5}        has paid here 3 times or more
    Shops set up before owners could edit these have the old fixed tiers, read here in the same shape."""
    if "discounts" in rules:
        return list(rules["discounts"])
    out = [{"kind": "total", "min_micro": t["min"], "percent": t["bps"] / 100} for t in rules.get("tiers", [])]
    if rules.get("group_bps"):
        out.append({"kind": "group", "people": 2, "min_micro": 8 * MICRO, "percent": rules["group_bps"] / 100})
    return out


def describe_rule(r: dict) -> str:
    """A rule in the words the shop's agent uses: 'orders of KES 1,000 or more'."""
    if r["kind"] == "total":
        return f"orders of KES {round(r['min_kes']) if 'min_kes' in r else shillings(r['min_micro']):,} or more"
    if r["kind"] == "group":
        return f"groups of {r['people']} or more"
    if r["kind"] == "time":
        return f"orders between {r['from']} and {r['to']}"
    return f"customers who have paid here {r['visits']} times or more"


def allowed_discount(rules: dict, lines: list[Line], people: int = 1, visits: int = 0,
                     now: datetime | None = None, tz: str = "Africa/Nairobi") -> tuple[int, str]:
    """The most the owner's rules allow for this order, in basis points, and the rule that allows it.
    Rules don't add up: the single most generous one that the order meets applies."""
    sub = subtotal(lines)
    clock = (now or datetime.now(ZoneInfo(tz))).astimezone(ZoneInfo(tz)).strftime("%H:%M")
    best, why = 0, ""
    for r in discount_rules(rules):
        if sub < (r["min_micro"] if "min_micro" in r else fx.to_micro(r.get("min_kes", 0))):
            continue
        if r["kind"] == "group" and people < r["people"]:
            continue
        if r["kind"] == "time" and not (r["from"] <= clock < r["to"] if r["from"] <= r["to"] else clock >= r["from"] or clock < r["to"]):
            continue
        if r["kind"] == "returning" and visits < r["visits"]:
            continue
        bps = round(float(r["percent"]) * 100)
        if bps > best:
            best, why = bps, describe_rule(r)
    return min(best, 5000), why


def allowed_discount_bps(rules: dict, items: list[dict], lines: list[Line], is_group: bool) -> int:
    return allowed_discount(rules, lines, 2 if is_group else 1)[0]


def price_request(items: list[dict], wanted: list[dict]) -> tuple[list[Line], list[str]]:
    """Price a request from the catalog, never from the customer's message. Returns (lines, missing names)."""
    by_sku = {i["sku"]: i for i in items}
    lines, missing = [], []
    for w in wanted:
        item = by_sku.get(str(w.get("sku", "")))
        try:
            qty = int(w.get("qty", 0))
        except (TypeError, ValueError):
            qty = 0
        if item is None or item["stock"] <= 0 or qty <= 0:
            missing.append(item["name"] if item else str(w.get("sku", "?")))
            continue
        lines.append(Line(item["sku"], item["name"], min(qty, item["stock"], 50), item["price"]))
    return lines, missing


# ---------------------------------------------------------------- customer side


@dataclass
class Goal:
    people: int
    budget: int | None
    veg: bool
    ticket: bool
    no_drink: bool


def parse_goal(goal: str, party_size: int = 1) -> Goal:
    g = goal.lower()
    b = re.search(r"(?:under|below|max|maximum|budget(?: of)?|less than|up to|at most)\s*(?:kes|ksh|kshs|sh)?\.?\s*(\d+(?:[.,]\d+)?)", g)
    p = re.search(r"for\s+(\d+|one|two|three|four|five|six)\b", g)
    people = max(party_size, (_WORDS.get(p.group(1)) or int(p.group(1))) if p else 1)
    return Goal(
        people=min(people, 12),
        budget=fx.to_micro(float(b.group(1).replace(",", ""))) if b else None,  # people say budgets in shillings
        veg=bool(re.search(r"\b(veg|vegetarian|vegan|no meat|meatless)\b", g)),
        ticket=bool(re.search(r"\b(ticket|entry|band|event|admission)\b", g)),
        no_drink=bool(re.search(r"\bno drinks?\b", g)),
    )


def trim_to_budget(lines: list[Line], budget: int | None) -> list[Line]:
    """Drop the cheapest extras first until the subtotal fits."""
    if not budget:
        return lines
    out = sorted((Line(**line.dict()) for line in lines), key=lambda line: line.unit_price)
    while subtotal(out) > budget and len(out) > 1:
        out.pop(0)
    while subtotal(out) > budget and out and out[0].qty > 1:
        out[0].qty -= 1
    return out


def scripted_basket(items: list[dict], goal: str, party_size: int = 1) -> list[Line]:
    """Named dishes if the request names any; otherwise a main, a side and a drink per person, within budget."""
    g = parse_goal(goal, party_size)
    text = goal.lower()
    if g.ticket:
        t = next((i for i in items if "ticket" in i["tags"] and i["stock"] > 0), None)
        return [Line(t["sku"], t["name"], 1, t["price"])] if t else []
    food = [i for i in items if "ticket" not in i["tags"] and i["stock"] > 0 and not (g.veg and "meat" in i["tags"])]

    def named(i: dict) -> bool:
        return i["sku"] in text or any(len(w) > 3 and w in text for w in i["name"].lower().split())

    picked = [i for i in food if named(i)]
    if picked:
        lines = []
        for i in picked:
            last = re.escape(i["name"].lower().split()[-1])
            q = re.search(rf"(\d+|one|two|three|four|five|six)\s+(?:x\s+)?(?:\w+\s+)?{last}", text)
            qty = (_WORDS.get(q.group(1)) or int(q.group(1))) if q else g.people
            lines.append(Line(i["sku"], i["name"], min(qty, i["stock"]), i["price"]))
        return trim_to_budget(lines, g.budget)

    per_head = g.budget / g.people if g.budget else float("inf")

    def best(tag: str, cap: float) -> dict | None:
        fits = [i for i in food if tag in i["tags"] and i["price"] <= cap]
        return max(fits, key=lambda i: i["price"]) if fits else None

    mains = [i for i in food if "main" in i["tags"]]
    main = best("main", per_head * 0.75) or (min(mains, key=lambda i: i["price"]) if mains else None)
    spent = main["price"] if main else 0
    side = best("side", max(0.0, per_head - spent) * 0.7)
    spent += side["price"] if side else 0
    drink = None if g.no_drink else best("drink", max(0.0, per_head - spent))
    lines = [Line(i["sku"], i["name"], min(g.people, i["stock"]), i["price"]) for i in (main, side, drink) if i]
    return trim_to_budget(lines, g.budget)


def sold_out_named(items: list[dict], goal: str) -> list[str]:
    """Names of sold-out items the request asks for by name."""
    text = goal.lower()
    return [i["name"] for i in items
            if i["stock"] <= 0 and (i["sku"] in text or any(len(w) > 3 and w in text for w in i["name"].lower().split()))]


def share_of(total: int, party_size: int, already_paid: int) -> int:
    """An equal share. The last person to pay covers the rounding remainder."""
    base = total // party_size
    return total - base * (party_size - 1) if already_paid >= party_size - 1 else base
