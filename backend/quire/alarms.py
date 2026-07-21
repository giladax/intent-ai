"""Proactive alarms: the tap on the shoulder, not the dashboard.

A CEO does not read a dashboard — they want to be told, unprompted, the one
thing that is on fire and who can put it out. This layer turns the event
stream's collision signals into ALARMS: it fires only when it matters, and
every alarm carries the STORY, not a label — what was promised, who signed
it, what broke it, that nobody is watching, and the one decision that fixes
it. That is the north star made concrete: propagate the reasoning and the
most relevant decision to the person who can act.

Same trust discipline as the rest of the stream. An alarm is QUOTE-BACKED:
it fires only when it can cite the receipts — the breaking check, the
promise it violated, the signing that put it on the map. No receipt, no
alarm; that is what keeps a proactive channel a signal instead of spam.

Deterministic — no LLM. Severity and audience are a fixed policy over the
collision taxonomy; the story is composed from the receipts. Delivery is
abstracted behind a sink (render now, wire Telegram/Slack post-raise behind
the same shape — we compose the message, we do not yet send it).
"""

from __future__ import annotations

import pathlib

import yaml
from pydantic import BaseModel, Field

from quire.entity_graph import read_state
from quire.events import ActivityEvent, collisions, events_for, parse_ts

# The alarm policy over the collision taxonomy: which signals tap whom, and
# how loud. Attention-rich drift (drift-in-context) is quieter to the exec —
# the team already owns it; the exec is paged for what NOBODY is holding.
_POLICY: dict[str, dict] = {
    "silent-drift":      {"severity": "critical", "audience": ["stakeholder", "pm", "dev"]},
    "drift-in-context":  {"severity": "high",     "audience": ["pm", "dev"]},
    "silent-build-risk": {"severity": "medium",   "audience": ["stakeholder", "pm"]},
    "all-talk-gap":      {"severity": "medium",   "audience": ["pm"]},
    "recovered":         {"severity": "info",     "audience": ["stakeholder", "pm"]},
}
_RANK = {"critical": 0, "high": 1, "medium": 2, "info": 3}
_ICON = {"critical": "🔴", "high": "🟠", "medium": "🟡", "info": "🟢"}


class Receipt(BaseModel):
    kind: str   # signing | promise | check | mandate | gap
    ref: str    # GD-2 | OB-CONSENT-1 | PR 342 | …
    note: str = ""


class Alarm(BaseModel):
    entity_id: str
    entity_name: str
    signal: str
    severity: str                 # critical | high | medium | info
    audience: list[str]           # roles to route to
    headline: str                 # one-line punch, addressed to a human
    story: str                    # the reasoning: promised → signed → broke → unwatched → fix
    receipts: list[Receipt] = Field(default_factory=list)
    dedup_key: str                # (entity, signal, break-ref) — same break won't re-page
    ts: str = ""                  # the event the alarm reflects (the break, usually)


def _obligations(workspace_dir: pathlib.Path) -> dict[str, str]:
    path = workspace_dir / "obligations.yaml"
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return {o["obligation_id"]: o.get("statement", "")
            for o in data.get("obligations", [])}


def _latest(events: list[ActivityEvent], entity_id: str, kind: str,
            where=lambda e: True) -> ActivityEvent | None:
    hits = [e for e in events
            if e.kind == kind and entity_id in e.entities and where(e)]
    return max(hits, key=lambda e: e.ts) if hits else None


def _days_since(ts: str, ref: str) -> int | None:
    a, b = parse_ts(ts), parse_ts(ref)
    return (b - a).days if a and b else None


def alarms_for(workspace_dir: pathlib.Path, adapter=None, store=None,
               window_days: float = 14, now: str | None = None,
               seen: set[str] | None = None) -> list[Alarm]:
    """Fire the alarms this workspace warrants, loudest first. `window_days`
    scopes 'is anyone watching' to the recent past (that is what makes a
    silent-drift alarm mean 'unwatched NOW'). `seen` suppresses dedup keys
    already delivered — the same unresolved break does not re-page every run;
    a NEW break (new check ref) is a new key and does fire."""
    seen = seen or set()
    events = events_for(workspace_dir, adapter, store)
    entities = read_state(workspace_dir)[1]["entities"]
    obligations = _obligations(workspace_dir)
    ref_now = now or (max((e.ts for e in events if e.ts), default="") or "")

    out: list[Alarm] = []
    for c in collisions(events, window_days=window_days, now=now):
        policy = _POLICY.get(c["signal"])
        if not policy:
            continue  # aligned / quiet never page
        eid = c["entity_id"]
        ent = entities.get(eid, {})
        name = ent.get("name", eid)
        alarm = _compose(workspace_dir, events, obligations, c, ent, name,
                         policy, window_days, ref_now)
        if alarm and alarm.dedup_key not in seen:
            out.append(alarm)
    return sorted(out, key=lambda a: (_RANK.get(a.severity, 99), a.entity_name))


def _compose(workspace_dir, events, obligations, c, ent, name, policy,
             window_days, ref_now) -> Alarm | None:
    eid, signal = c["entity_id"], c["signal"]
    receipts: list[Receipt] = []

    signing = _latest(events, eid, "signing")
    if signing:
        receipts.append(Receipt(kind="signing", ref=signing.ref,
                                note=f"signed into the map {signing.ts[:10]}"
                                     f" by {signing.actor}"))

    # the promise that is (or was) in play, and the breaking check
    break_check = _latest(events, eid, "check", where=lambda e: e.broken)
    ob_ids = (break_check.promises if break_check else []) or [
        h["ref"] for h in ent.get("holdings", []) if h["kind"] == "promise"]
    statement = next((obligations[o] for o in ob_ids if o in obligations), "")
    if ob_ids:
        receipts.append(Receipt(kind="promise", ref=ob_ids[0], note=statement))

    break_ref = ""
    if break_check:
        break_ref = f"PR {break_check.ref}"
        receipts.append(Receipt(kind="check", ref=break_ref,
                                note=f"{break_check.text} · {break_check.ts[:10]}"))

    # QUOTE-OR-DROP: a drift alarm must cite the break. No breaking check,
    # no drift alarm — we do not page on a state we cannot show.
    if signal in ("silent-drift", "drift-in-context") and not break_check:
        return None

    a, d = c["attention"], c["dev"]
    if signal in ("silent-drift", "drift-in-context", "silent-build-risk"):
        receipts.append(Receipt(kind="gap", ref=f"{window_days:g}d window",
                                note=f"{a} message(s), {d} dev event(s) touched "
                                     f"{name} in the last {window_days:g} days"))

    dedup_key = f"{eid}:{signal}:{break_ref or 'none'}"
    ts = break_check.ts if break_check else ref_now
    headline, story = _narrate(signal, name, statement, break_check,
                               signing, a, window_days, ref_now)
    return Alarm(entity_id=eid, entity_name=name, signal=signal,
                 severity=policy["severity"], audience=policy["audience"],
                 headline=headline, story=story, receipts=receipts,
                 dedup_key=dedup_key, ts=ts)


def _narrate(signal, name, statement, break_check, signing, attention,
             window_days, ref_now) -> tuple[str, str]:
    """Compose the human sentence per signal — the reasoning, not the label."""
    promise = f'“{statement}”' if statement else f"a promise on {name}"
    since = _days_since(break_check.ts, ref_now) if break_check else None
    ago = f"{since} day{'s' if since != 1 else ''} ago" if since is not None else "recently"
    signed = (f" It was signed into the map on {signing.ts[:10]}." if signing else "")

    if signal == "silent-drift":
        return (
            f"{name} broke {ago} — and no one is watching.",
            f"{name} carries {promise} That promise broke in PR {break_check.ref} "
            f"{ago} ({break_check.text}), and in the {window_days:g}-day window "
            f"not one message landed on {name} — the only thing that touched it "
            f"was the change that broke it.{signed} It was governed once and then "
            f"forgotten at the exact moment it mattered. If this change is intended, "
            f"sign it; if not, it needs an owner now.")
    if signal == "drift-in-context":
        return (
            f"{name} broke {ago} — the team is on it.",
            f"{name}'s promise {promise} broke in PR {break_check.ref} {ago} "
            f"({break_check.text}). Unlike a silent drift, this one has eyes — "
            f"{attention} message(s) touched {name} in the window. Watch that it lands.")
    if signal == "silent-build-risk":
        return (
            f"{name} is being built with no one discussing it.",
            f"Code kept shipping against {name} while the org said nothing about it "
            f"in the last {window_days:g} days — build outrunning intent. "
            f"Worth a second set of eyes before it drifts unseen.")
    if signal == "all-talk-gap":
        return (
            f"{name} is all talk — nothing has shipped.",
            f"{name} has drawn real discussion but zero build. "
            f"Either it is blocked, or the intent needs to become work.")
    if signal == "recovered":
        return (
            f"{name} broke and was caught — closed the loop. ✓",
            f"{name}'s promise broke earlier and a later check confirmed it holds "
            f"again. Good news, surfaced so the fix is on the record.")
    return (f"{name}: {signal}", f"{name} is in state {signal}.")


# -- delivery: compose now, send later -------------------------------------

# Plain-language labels for the push, so a reader who has never seen Quire's
# internal taxonomy still understands the receipt and the routing.
_RECEIPT_LABEL = {"signing": "signed", "promise": "promise", "check": "check",
                  "mandate": "mandate", "gap": "coverage"}
_AUDIENCE_LABEL = {"stakeholder": "exec", "pm": "product", "dev": "engineering"}


def render_telegram(alarm: Alarm) -> str:
    """A push-ready message. Telegram/Slack wiring is a post-raise fast-follow
    behind this same shape — the org maps a role → a chat the way channels.yaml
    maps a channel → an entity."""
    icon = _ICON.get(alarm.severity, "•")
    lines = [f"{icon} *{alarm.severity.upper()}* — {alarm.headline}",
             "", alarm.story, "", "_Receipts:_"]
    for r in alarm.receipts:
        note = f" — {r.note}" if r.note else ""
        lines.append(f"  • {_RECEIPT_LABEL.get(r.kind, r.kind)}: `{r.ref}`{note}")
    lines.append("")
    to = ", ".join(_AUDIENCE_LABEL.get(role, role) for role in alarm.audience)
    lines.append(f"_to: {to}_")
    return "\n".join(lines)


class Notifier:
    """Delivery sink. The console notifier proves the shape; a Telegram/Slack
    notifier drops in behind the same interface without touching alarm logic."""

    def send(self, alarm: Alarm) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class ConsoleNotifier(Notifier):
    def __init__(self) -> None:
        self.sent: list[Alarm] = []

    def send(self, alarm: Alarm) -> None:
        self.sent.append(alarm)
        print(render_telegram(alarm))
        print()


def deliver(alarms: list[Alarm], notifier: Notifier) -> int:
    for a in alarms:
        notifier.send(a)
    return len(alarms)
