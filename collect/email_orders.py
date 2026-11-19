"""Food, grocery, pharmacy, lab and travel emails -> what the user ate, bought and did.

Only mail from known merchants is ever fetched (the Gmail search names the
senders), so personal mail is never read. Each order is classified by the AI
(what was ordered, how junk-heavy, alcohol/tobacco/caffeine, which medicines
were bought and for what) and mapped onto that day's food log, so the chat can
say "you ordered fried food at 23:40 on Tuesday" without the user typing it.
The Gmail access token is used for one sync and never stored.
"""

from __future__ import annotations

import base64
import html
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
MAX_MESSAGES = 60
MAX_BODY_CHARS = 2500
BATCH_SIZE = 8

# sender domain fragment -> category hint
SENDERS: dict[str, str] = {
    "swiggy": "food",
    "zomato": "food",
    "eatsure": "food",
    "dominos": "food",
    "jubilantfoodworks": "food",
    "pizzahut": "food",
    "mcdonalds": "food",
    "kfc": "food",
    "burgerking": "food",
    "box8": "food",
    "faasos": "food",
    "magicpin": "food",
    "zepto": "grocery",
    "blinkit": "grocery",
    "bigbasket": "grocery",
    "jiomart": "grocery",
    "dunzo": "grocery",
    "pharmeasy": "pharmacy",
    "1mg": "pharmacy",
    "netmeds": "pharmacy",
    "apollopharmacy": "pharmacy",
    "apollo247": "pharmacy",
    "medplus": "pharmacy",
    "truemeds": "pharmacy",
    "thyrocare": "lab",
    "lalpathlabs": "lab",
    "redcliffelabs": "lab",
    "healthians": "lab",
    "metropolisindia": "lab",
    "agilus": "lab",
    "orangehealth": "lab",
    "cult.fit": "fitness",
    "curefit": "fitness",
    "irctc": "travel",
    "makemytrip": "travel",
    "goibibo": "travel",
    "cleartrip": "travel",
    "goindigo": "travel",
    "airindia": "travel",
    "redbus": "travel",
}

GMAIL_QUERY_DOMAINS = (
    "swiggy.in zomato.com eatsure.com dominos.co.in jubilantfoodworks.com pizzahut.co.in mcdonaldsindia.com kfc.co.in "
    "box8.in faasos.io zeptonow.com blinkit.com bigbasket.com jiomart.com pharmeasy.in 1mg.com netmeds.com "
    "apollopharmacy.in apollo247.com medplusmart.com truemeds.in thyrocare.com lalpathlabs.com redcliffelabs.com "
    "healthians.com metropolisindia.com orangehealth.in cult.fit irctc.co.in makemytrip.com goibibo.com cleartrip.com "
    "goindigo.in airindia.com redbus.in"
).split()

KINDS = ("food_order", "grocery_order", "pharmacy_order", "lab_booking", "lab_report", "fitness_booking", "travel", "not_relevant")
MEDICINE_USES = ("pain_fever", "acidity_digestion", "nausea_vomiting", "loose_motion", "cold_cough_allergy", "antibiotic", "vitamin_supplement", "skin", "sleep", "other")

ORDER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "emails": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "merchant": {"type": "string"},
                    "items": {"type": "array", "items": {"type": "string"}},
                    "food_quality": {"type": "string", "enum": ["healthy", "mixed", "junk", "none"]},
                    "fried_or_fast_food": {"type": "boolean"},
                    "sugary": {"type": "boolean"},
                    "alcohol": {"type": "boolean"},
                    "tobacco": {"type": "boolean"},
                    "caffeine": {"type": "boolean"},
                    "medicines": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"name": {"type": "string"}, "use": {"type": "string", "enum": list(MEDICINE_USES)}},
                            "required": ["name", "use"],
                        },
                    },
                    "test_names": {"type": "array", "items": {"type": "string"}},
                    "travel_to": {"type": "string"},
                    "travel_date": {"type": "string", "description": "YYYY-MM-DD of the journey, if stated"},
                },
                "required": ["index", "kind"],
            },
        }
    },
    "required": ["emails"],
}

ORDER_PROMPT = """These are order and booking emails from a person's own inbox, collected (with their permission) so their health assistant knows what they ate, bought and did. For each email return one entry with its index.

- kind: food_order (restaurant/delivery meal), grocery_order, pharmacy_order, lab_booking (test booked), lab_report (results attached or in the mail), fitness_booking, travel (train/flight/bus ticket), or not_relevant (marketing, offers, newsletters, OTPs, refunds without an order).
- merchant: the brand, e.g. Swiggy, Zepto, PharmEasy.
- items: what was ordered, short, with quantity if shown ("2x Chicken biryani", "Coca-Cola 750ml"). For groceries list only food, drink, tobacco and health items.
- food_quality: healthy / mixed / junk / none (no food). fried_or_fast_food, sugary (sweets, desserts, soft drinks), alcohol, tobacco (cigarettes, gutka), caffeine (coffee, energy drinks): true only if an ordered item is that.
- medicines: each medicine or health product bought, with its likely use.
- test_names: lab tests booked or reported.
- travel_to / travel_date: destination and journey date for tickets.
Use only what the email says.

EMAILS:
{emails}
"""


@dataclass
class EmailMessage:
    id: str
    sender: str
    subject: str
    sent_at: datetime
    text: str
    pdf_attachments: list[tuple[str, str]] = field(default_factory=list)  # (filename, attachment_id)

    @property
    def category(self) -> str | None:
        return sender_category(self.sender)


def sender_category(sender: str) -> str | None:
    address = parseaddr(sender)[1].lower() or sender.lower()
    domain = address.split("@")[-1]
    for fragment, category in SENDERS.items():
        if fragment in domain:
            return category
    return None


def html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|head).*?>.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</div>|</li>|</h\d>", "\n", markup)
    markup = re.sub(r"(?i)</?(b|i|u|em|strong|span|a|font|small)\b[^>]*>", "", markup)  # inline: no gap
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup)).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\s*\n\s*", "\n", text).strip()


def gmail_query(days: int) -> str:
    return f"from:({' OR '.join(GMAIL_QUERY_DOMAINS)}) newer_than:{days}d -category:promotions"


# ---------- Gmail ----------


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _walk_parts(payload: dict[str, Any]) -> tuple[str, str, list[tuple[str, str]]]:
    plain, markup, pdfs = "", "", []
    stack = [payload]
    while stack:
        part = stack.pop()
        stack.extend(part.get("parts") or [])
        mime = part.get("mimeType", "")
        body = part.get("body") or {}
        filename = part.get("filename") or ""
        if filename.lower().endswith(".pdf") and body.get("attachmentId"):
            pdfs.append((filename, body["attachmentId"]))
        elif mime == "text/plain" and body.get("data") and not plain:
            plain = _decode(body["data"])
        elif mime == "text/html" and body.get("data") and not markup:
            markup = _decode(body["data"])
    return plain, markup, pdfs


async def fetch_gmail_messages(
    client: httpx.AsyncClient,
    access_token: str,
    *,
    days: int,
    skip_ids: set[str],
) -> list[EmailMessage]:
    headers = {"Authorization": f"Bearer {access_token}"}
    listing = await client.get(f"{GMAIL_API}/messages", params={"q": gmail_query(days), "maxResults": MAX_MESSAGES}, headers=headers)
    if listing.status_code == 401:
        raise PermissionError("Gmail access expired")
    listing.raise_for_status()
    messages: list[EmailMessage] = []
    for ref in listing.json().get("messages", []):
        if ref["id"] in skip_ids:
            continue
        response = await client.get(f"{GMAIL_API}/messages/{ref['id']}", params={"format": "full"}, headers=headers)
        if response.status_code != 200:
            continue
        data = response.json()
        head = {h["name"].lower(): h["value"] for h in (data.get("payload") or {}).get("headers", [])}
        try:
            sent_at = parsedate_to_datetime(head.get("date", ""))
        except (TypeError, ValueError):
            sent_at = datetime.fromtimestamp(int(data.get("internalDate", "0")) / 1000, tz=timezone.utc)
        plain, markup, pdfs = _walk_parts(data.get("payload") or {})
        text = plain.strip() or html_to_text(markup) or data.get("snippet", "")
        messages.append(
            EmailMessage(
                id=ref["id"],
                sender=head.get("from", ""),
                subject=head.get("subject", ""),
                sent_at=sent_at,
                text=text[:MAX_BODY_CHARS],
                pdf_attachments=pdfs[:2],
            )
        )
    return messages


async def fetch_gmail_attachment(client: httpx.AsyncClient, access_token: str, message_id: str, attachment_id: str) -> bytes:
    response = await client.get(
        f"{GMAIL_API}/messages/{message_id}/attachments/{attachment_id}", headers={"Authorization": f"Bearer {access_token}"}
    )
    response.raise_for_status()
    return base64.urlsafe_b64decode(response.json()["data"] + "==")


# ---------- classification ----------


async def classify_emails(ai_client: Any, emails: list[EmailMessage]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for start in range(0, len(emails), BATCH_SIZE):
        batch = emails[start : start + BATCH_SIZE]
        listing = "\n\n".join(
            f"[{i}] From: {e.sender}\nSubject: {e.subject}\nSent: {e.sent_at.isoformat()}\n{e.text}" for i, e in enumerate(batch)
        )
        reply = await ai_client.generate_json(prompt=ORDER_PROMPT.format(emails=listing), schema=ORDER_SCHEMA, timeout=60.0, max_tokens=3000)
        by_index = {item.get("index"): item for item in (reply or {}).get("emails", []) if isinstance(item, dict)}
        for i, message in enumerate(batch):
            item = by_index.get(i) or {"kind": "not_relevant"}
            if item.get("kind") not in KINDS:
                item["kind"] = "not_relevant"
            results.append({**item, "email": message})
    return results


# ---------- mapping onto days ----------


def _meal_slot(hour: int) -> str:
    if 5 <= hour < 11:
        return "breakfast"
    if 11 <= hour < 16:
        return "lunch"
    if 16 <= hour < 19:
        return "snacks"
    return "dinner"


def order_rows(parsed: list[dict[str, Any]], *, utc_offset_minutes: int) -> tuple[dict[str, dict[str, dict[str, Any]]], list[dict[str, Any]]]:
    """Returns (daily rows to write, items for the 'picked up' feed)."""
    local_tz = timezone(timedelta(minutes=utc_offset_minutes))
    rows: dict[str, dict[str, dict[str, Any]]] = {}
    items: list[dict[str, Any]] = []

    for entry in parsed:
        kind = entry.get("kind")
        if kind == "not_relevant":
            continue
        message: EmailMessage = entry["email"]
        when = message.sent_at.astimezone(local_tz)
        day = when.date().isoformat()
        merchant = (entry.get("merchant") or message.category or "Order").strip()
        what = [str(i).strip() for i in entry.get("items") or [] if str(i).strip()]
        late = when.hour >= 22 or when.hour < 5
        memory = rows.setdefault("daily_user_memory_logs", {}).setdefault(day, {})
        flags: list[str] = []
        events: list[str] = []

        if kind == "food_order":
            slot = _meal_slot(when.hour)
            meal = f"{merchant}: {', '.join(what[:6]) or 'meal'} (ordered {when:%H:%M})"
            memory[slot] = f"{memory[slot]}; {meal}" if memory.get(slot) else meal
            memory["ate_from_outside"] = True
            flags.append("ordered food")
            if entry.get("food_quality") == "junk" or entry.get("fried_or_fast_food"):
                memory["processed_food_consumed"] = True
                memory["unusual_food_exposure"] = True
                flags.append("fried/fast food")
            if late:
                flags.append("late-night food")
        if kind in {"food_order", "grocery_order"}:
            for key, label in (("sugary", "sugary food/drinks"), ("alcohol", "alcohol"), ("tobacco", "tobacco"), ("caffeine", "caffeine")):
                if entry.get(key):
                    flags.append(label)
            if kind == "grocery_order" and what:
                events.append(f"Groceries from {merchant}: {', '.join(what[:6])}")
        if kind == "pharmacy_order":
            medicines = [m for m in entry.get("medicines") or [] if isinstance(m, dict) and m.get("name")]
            listed = ", ".join(f"{m['name']} ({str(m.get('use', 'other')).replace('_', ' ')})" for m in medicines) or ", ".join(what)
            events.append(f"Bought from {merchant}: {listed}")
            if any(m.get("use") == "antibiotic" for m in medicines):
                flags.append("antibiotic bought")
        if kind in {"lab_booking", "lab_report"}:
            tests = ", ".join(entry.get("test_names") or []) or "lab tests"
            events.append(f"{'Lab results' if kind == 'lab_report' else 'Booked'}: {tests} ({merchant})")
        if kind == "fitness_booking":
            events.append(f"Fitness booking: {merchant} {', '.join(what[:2])}".strip())
        if kind == "travel":
            travel_day = str(entry.get("travel_date") or "")[:10] or day
            rows.setdefault("daily_calendar_data", {}).setdefault(travel_day, {})["travel_event"] = True
            rows.setdefault("daily_user_memory_logs", {}).setdefault(travel_day, {})["travel_today"] = True
            events.append(f"Travel booked to {entry.get('travel_to') or 'another city'} on {travel_day}")

        # Several orders can land on one day: add to that day's lists rather than replace them.
        for key, values in (("food_flags", flags), ("daily_events", events)):
            if values:
                existing = memory.setdefault(key, [])
                existing.extend(v for v in values if v not in existing)
        summary = {
            "food_order": f"{merchant}: {', '.join(what[:4]) or 'meal'}",
            "grocery_order": f"{merchant} groceries: {', '.join(what[:4])}",
            "pharmacy_order": events[0] if events else f"{merchant} order",
            "lab_booking": events[0] if events else merchant,
            "lab_report": events[0] if events else merchant,
            "fitness_booking": events[0] if events else merchant,
            "travel": events[-1] if events else merchant,
        }.get(kind, merchant)
        items.append(
            {
                "item_id": message.id,
                "happened_at": when.isoformat(timespec="minutes"),
                "kind": kind,
                "summary": summary,
                "details": {"flags": flags, "items": what, "merchant": merchant, "late_night": late},
            }
        )
    return rows, items
