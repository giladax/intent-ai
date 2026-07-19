"""The story layer: the clerk narrates the plot — and cites.

Design: docs/2026-07-19-story-layer-design.md. The data already IS a
story (entities born by signature, promises breaking at named checks,
rejections teaching); this module has the LLM narrate it under the same
evidence discipline as everything else:

- every sentence carries structured citations; a sentence whose
  citations do not ALL resolve is dropped before render (the law of
  quote validation, applied to prose);
- "because / so that / in order to" is allowed only when the sentence
  cites a reason-bearing artifact (a decision, a teaching) — temporal
  sequence is observable, causality must be somebody's recorded reason;
- stories are derived and disposable: cached in the workspace's
  stories.yaml, keyed on an input hash, never read by the fold, safe to
  delete. Regeneration happens on data change, never per page view.

A story that loses every sentence renders as NO story — a missing story
is honest; a hollow one is not.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from quire_align.entity_graph import graph_state, load_diffs
from quire_align.llm_retry import invoke_with_retry

STORY_MODEL = "claude-sonnet-4-6"

_CAUSAL = re.compile(r"\bbecause\b|\bso that\b|\bin order to\b", re.IGNORECASE)
# kinds that carry a recorded human reason (a decision's reason/question,
# a teaching) — the only license for causal language
_REASON_BEARING = {"diff", "teach"}


class Citation(BaseModel):
    kind: Literal["check", "diff", "promise", "teach"]
    ref: str  # check number, GD-N, promise id, or the taught word


class Sentence(BaseModel):
    text: str
    cites: list[Citation] = Field(default_factory=list)


class Story(BaseModel):
    sentences: list[Sentence] = Field(default_factory=list)


class StorytellerLLM:
    def __init__(self, model: str = STORY_MODEL) -> None:
        from langchain_anthropic import ChatAnthropic

        self._model = ChatAnthropic(
            model=model, temperature=0, max_tokens=2048
        ).with_structured_output(Story)

    def tell(self, scope: str, facts: str, budget: str) -> Story:
        return invoke_with_retry(
            self._model,
            "You are the clerk of an organization's map, narrating its "
            "plot. Write the story from the LABELED FACTS below — nothing "
            "else exists.\n\n"
            f"Story type and budget: {budget}\n\n"
            "Craft rules:\n"
            "- Open on the tension if one exists, else the newest change, "
            "else continuity. One sentence of stakes at most. Every "
            "sentence must have a plot function — no inventory prose.\n"
            "- Every sentence carries the citations of the facts it uses "
            "(the refs in brackets). A sentence you cannot cite will be "
            "deleted by a validator — do not write it.\n"
            "- NEVER: assert motive (only a recorded reason may be "
            "narrated, cited to its decision); predict; flatter; console; "
            "score. 'Because/so that/in order to' ONLY when citing a "
            "decision or teaching that states the reason. Temporal "
            "sequence ('then', 'after check #7') is always allowed; "
            "correlation is narrated as sequence, never upgraded to "
            "cause.\n"
            "- Proposed things are always marked unbound ('in quires', "
            "'unsigned') — never narrated as if they happened. Signed "
            "events name their signer. Plain declarative voice; the "
            "narrator is invisible; no 'I'.\n"
            "- A DECLINED proposal was REFUSED: narrate the refusal and "
            "its recorded reason; never narrate the proposal's own "
            "question as if it were true, preferred, or concluded.\n"
            "- No inventory prose: never enumerate ids in parentheses or "
            "lists — one plot point per sentence, ids only as citations.\n"
            "- Citation refs, exactly: GD-N is kind 'diff'; a promise id "
            "(e.g. QUIREB-006) is kind 'promise'; a check cites kind "
            "'check' with the NUMBER alone as ref. Cite at most the THREE "
            "load-bearing refs per sentence — a wall of citations is "
            "inventory wearing a costume.\n"
            "- Signers appear exactly as recorded (their signature is "
            "their name, whatever its case).\n\n"
            f"## Labeled facts — {scope}\n{facts}",
        )


class FakeStoryteller:
    def __init__(self, canned: Story) -> None:
        self._canned = canned

    def tell(self, scope: str, facts: str, budget: str) -> Story:
        return self._canned


# -- the universe a citation must resolve against -------------------------


def _universe(workspace_dir: pathlib.Path, adapter, store) -> dict:
    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    taught = {
        a.lower()
        for e in state["entities"].values()
        for a in e["aliases"]
    }
    checks = {
        str(a.pr_number)
        for a in store.list_analyses(repository=adapter.repository())
    }
    return {
        "check": checks,
        "diff": {d.diff_id for d in diffs},
        "promise": {o.obligation_id for o in adapter.obligations()},
        "teach": taught,
    }


def _normalize_cite(cite: Citation, universe: dict) -> Citation | None:
    """Resolve a citation against the universe BY SHAPE, tolerating the
    model's labeling noise ('check #7' for check 7; kind 'promise' on a
    GD ref). The ref is the fact; the kind is presentation. Returns the
    corrected citation, or None when the ref resolves nowhere."""
    raw = cite.ref.strip()
    digits = re.sub(r"[^0-9]", "", raw)
    # declared kind first, then by shape — strictness lives in "must
    # resolve somewhere", not in trusting the label
    trials = [
        ("diff", raw.upper()),
        ("promise", raw.upper()),
        ("check", digits),
        ("teach", raw.lower()),
    ]
    trials.sort(key=lambda t: t[0] != cite.kind)
    for kind, ref in trials:
        if ref and ref in universe[kind]:
            return Citation(kind=kind, ref=ref)
    return None


def validate_story(story: Story, universe: dict) -> tuple[list[Sentence], int]:
    """The validator decides what renders. Returns (kept, dropped)."""
    kept, dropped = [], 0
    for sentence in story.sentences:
        if not sentence.cites:
            dropped += 1
            continue
        normalized = [_normalize_cite(c, universe) for c in sentence.cites]
        if any(c is None for c in normalized):
            dropped += 1
            continue
        if _CAUSAL.search(sentence.text) and not any(
            c.kind in _REASON_BEARING for c in normalized
        ):
            dropped += 1  # causality without a recorded reason
            continue
        kept.append(Sentence(text=sentence.text, cites=normalized))
    return kept, dropped


# -- labeled facts: the only world the model may narrate ------------------


def _atom_ref(cite: dict) -> str:
    if cite["kind"] == "check":
        return f"[check #{cite['ref']}]"
    if cite["kind"] == "teach":
        return f'[taught: "{cite["ref"]}"]'
    return f"[{cite['ref']}]"


def _atom_lines(atoms: list[dict]) -> list[str]:
    """Atoms ARE the plot — the model phrases them; it never reads raw
    tables (and never sees another entity's cargo to mis-narrate)."""
    return [
        f"- {a['at'][:10] + ': ' if a.get('at') else ''}{a['text']} "
        + " ".join(_atom_ref(c) for c in a["cites"])
        for a in atoms
    ]


def _health_facts(adapter, store, member_refs: set[str] | None = None) -> list[str]:
    from quire_align.timeline import build_timeline

    analyses = store.list_analyses(repository=adapter.repository())
    events = build_timeline(adapter, analyses)["events"]
    current = events[-1]["state_after"] if events else {}
    statements = {o.obligation_id: o.statement for o in adapter.obligations()}
    label = {"contradicts": "BROKEN", "partially_satisfies": "PARTLY KEPT",
             "satisfies": "holding"}

    def finding_reason(ref: str, check) -> str:
        """What the check actually FOUND — without it the narrator can
        only restate the promise, and any mechanism it adds is an
        invention the faithfulness judge rightly kills."""
        mine = [a for a in analyses if a.pr_number == check]
        if not mine:
            return ""
        latest = max(mine, key=lambda a: a.created_at)
        for impact in latest.obligation_impacts:
            if impact.obligation_id == ref and impact.reasoning:
                return f' The check found: "{impact.reasoning[:160]}"'
        return ""

    facts = []
    for ref, entry in current.items():
        if member_refs is not None and ref not in member_refs:
            continue
        status = entry.get("status")
        if status not in label:
            facts.append(
                f"- Promise {ref} has not yet been exercised by any check: "
                f"“{statements.get(ref, '')[:110]}” [{ref}]"
            )
            continue
        since = entry.get("since")
        facts.append(
            f"- Promise {ref} is {label[status]}"
            + (f" since check #{since} [check #{since}] [{ref}]" if since else f" [{ref}]")
            + f": “{statements.get(ref, '')[:110]}”"
            + (finding_reason(ref, since) if since and status != "satisfies" else "")
        )
    return facts


def _org_facts(workspace_dir, adapter, store) -> str:
    from quire_align.atoms import atoms_for

    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    active = [e for e in state["entities"].values() if e["status"] == "active"]
    housed = {
        h["ref"] for e in active for h in e["holdings"] if h["kind"] == "promise"
    }
    lines = [
        f"- The map holds {len(active)} active names and "
        f"{len(housed)} housed promises (of "
        f"{len(list(adapter.obligations()))} approved)"
        + (" " + " ".join(f"[{d.diff_id}]" for d in diffs if d.status == "approved"))
    ]
    lines += _atom_lines(atoms_for(workspace_dir, adapter, store))
    lines += _health_facts(adapter, store)
    return "\n".join(lines)


def _entity_facts(workspace_dir, adapter, store, entity_id: str) -> str:
    from quire_align.atoms import atoms_for

    diffs = load_diffs(workspace_dir)
    state = graph_state(diffs)
    entity = state["entities"][entity_id]
    refs = {h["ref"] for h in entity["holdings"] if h["kind"] == "promise"}
    lines = [
        f"- The entity is “{entity['name']}”: {entity['identity_sentence']}",
    ]
    # scoped atoms only — another entity's cargo is not this record's
    # story (stakeholder round 1, defect 11)
    lines += _atom_lines(
        atoms_for(workspace_dir, adapter, store, entity_id=entity_id)
    )
    lines += _health_facts(adapter, store, member_refs=refs)
    for other in state["entities"].values():
        shared = refs & {
            h["ref"] for h in other["holdings"] if h["kind"] == "promise"
        }
        if other["entity_id"] != entity_id and shared:
            lines.append(
                f"- {other['name']} also holds "
                + ", ".join(sorted(shared))
                + " (a shared promise; do not narrate that entity's other "
                "contents) "
                + " ".join(f"[{r}]" for r in sorted(shared))
            )
    return "\n".join(lines)


_BUDGETS = {
    "org": "the org lede — 3 to 5 sentences; present tense for standing, past for events",
    "entity": "the story so far — 2 to 6 sentences, scaled to how much has actually happened; past into present",
}


def haiku_faithfulness_judge(sentence: str, facts: str) -> bool:
    """The content gate, owed since the first live falsehood ('the last
    two after edits' — plausible, cited, wrong): a sentence must make
    ONLY claims the facts support. Selection and summary are fine; any
    detail the facts don't state — an attribution, a count, a which-one
    — fails. Grades quality; citations remain the mechanical gate."""
    from langchain_anthropic import ChatAnthropic
    from pydantic import BaseModel, Field

    class Verdict(BaseModel):
        reasoning: str = ""
        faithful: bool = Field(
            description="True only if every claim in the sentence — every "
            "attribution, number, date, and which-item-did-what — is "
            "stated by the facts. Summarizing fewer facts is fine; "
            "compressing them into a detail the facts don't state is not."
        )

    model = ChatAnthropic(
        model="claude-haiku-4-5", temperature=0, max_tokens=256
    ).with_structured_output(Verdict)
    verdict = invoke_with_retry(
        model,
        "A narrator wrote one sentence from a list of facts. Judge ONLY "
        "whether the sentence is faithful to the facts — not style.\n"
        "Attribution law: a decision's ground must match its RECORDED "
        "reason exactly; a refused proposal's own wording is never the "
        "ground for its refusal — a sentence that presents the rejected "
        "question as the decider's conclusion is unfaithful.\n\n"
        f"## Facts\n{facts}\n\n## Sentence\n{sentence}",
    )
    return bool(verdict.faithful)


# -- cache: derived, disposable, never read by the fold -------------------


def _stories_file(workspace_dir: pathlib.Path) -> pathlib.Path:
    return workspace_dir / "stories.yaml"


def _load_cache(workspace_dir) -> dict:
    path = _stories_file(workspace_dir)
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text()) or {}


def _newest_event_label(workspace_dir, adapter, store) -> str:
    """What just changed — the byline's 'retold after …'."""
    from quire_align.atoms import atoms_for

    atoms = atoms_for(workspace_dir, adapter, store)
    if not atoms:
        return ""
    cite = atoms[-1]["cites"][0]
    return f"check #{cite['ref']}" if cite["kind"] == "check" else cite["ref"]


def get_story(
    workspace_dir: pathlib.Path,
    adapter,
    store,
    scope: str,
    teller=None,
    entity_id: str = "",
    now: str = "",
    judge=None,
) -> dict | None:
    """Cached story for a scope, retold only when its inputs changed.
    teller=None → cache only (a missing story is honest). judge runs at
    generation time only — the faithfulness gate on each sentence."""
    key = f"entity:{entity_id}" if scope == "entity" else "org"
    facts = (
        _entity_facts(workspace_dir, adapter, store, entity_id)
        if scope == "entity"
        else _org_facts(workspace_dir, adapter, store)
    )
    input_hash = hashlib.sha256(facts.encode()).hexdigest()[:16]
    cache = _load_cache(workspace_dir)
    cached = cache.get(key)
    if cached and cached.get("input_hash") == input_hash:
        return cached
    if teller is None:
        return cached  # stale is better than hollow; None when never told
    story = teller.tell(key, facts, _BUDGETS[scope])
    kept, dropped = validate_story(
        story, _universe(workspace_dir, adapter, store)
    )
    unfaithful = 0
    if judge is not None:
        faithful = []
        for sentence in kept:
            if judge(sentence.text, facts):
                faithful.append(sentence)
            else:
                unfaithful += 1
        kept = faithful
    entry = {
        "scope": key,
        "input_hash": input_hash,
        "sentences": [s.model_dump() for s in kept],
        "dropped": dropped,
        "unfaithful": unfaithful,
        "generated_at": now,
        "retold_after": _newest_event_label(workspace_dir, adapter, store),
        "model": STORY_MODEL,
    }
    cache[key] = entry
    _write_cache(workspace_dir, cache)
    return entry


def _write_cache(workspace_dir: pathlib.Path, cache: dict) -> None:
    """Atomic replace — the cache is disposable, a torn write is not."""
    import os
    import tempfile

    path = _stories_file(workspace_dir)
    payload = (
        "# Derived narrative cache — disposable; never read by the fold.\n"
        + yaml.safe_dump(cache, sort_keys=False, allow_unicode=True)
    )
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w") as handle:
        handle.write(payload)
    os.replace(tmp, path)
