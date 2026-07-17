# Product-surface language audit (2026-07-17)

Tier 1:
1. "digestion" everywhere → "check"/"analysis" (meta line, stage header, effect panel, pill, ask card, CLI, README)
2. Contract shown as hash (⟡a2afeb8c chips, stage sub-line, revision marker, render footer) → "Contract v2 · approved Jul 16"; hash only in tooltip/title
3. Bare obligation IDs in render.py table and intent.html effect rows → statement-first, id in parens
4. "obligations" vs "promises" split → "promises" on all user-facing surfaces; "obligation" only in YAML
5. "UNGOVERNED"/"Ungoverned surface" → display "NOT COVERED"/"Not covered by the product contract" (enum value unchanged)
6. "UNOBSERVED" → "NO EVIDENCE YET" (lamp, arrows, CLI [unobserved])
7. Footer math-proof copy → "Every verdict is recorded against the exact commit and contract version it was judged under. Scrub the timeline to see intent state at any moment. ⟡ = the product intent itself changed."
8. onboard step 4 "First light"/"retroactive sweep (live inference)" → "First results" / "See it judge your recent commits" / "Check the last 5 commits"
9. render.py "**Abstained:**" → "**No verdict — needs a human:**"
10. CLI _print_analysis key=value dump → human sentence + how to use the analysis id
11. "control points" user-facing → "code locations" / header "WHERE IT LIVES IN CODE" (YAML keeps control_point_id)

Tier 2 (apply all): ask meta "via lexical · confidence 0.62"→"matched by name (62%)", "via llm"→"best guess"; ask failure copy; group label leads, id muted; "conf 0.82"→"confidence 82%"; "3 missing-evidence item(s)"→"3 claims not yet verified"; kind glyph tooltips; badges NO MATERIAL IMPACT→NO PRODUCT IMPACT, OFF INTENT→CONTRADICTS INTENT, UNKNOWN→NEEDS REVIEW (display only); ledger empty state; load()/ask fetch error states; truncate head SHA in rows; onboard "workflow id"→"workspace name"; "bridged files"→"files shared with other areas"; "weight 0.4 (primary in G1)"→"40% related — mainly in <label>"; "edits retrain…"→"your edits update the grouping and are saved"; dropped-candidates copy; "promise density"→"how many product promises they contain"; draft/regroup/create fetch error paths; render "Relation"→"Effect"; "Rejected sources"→"Out-of-date sources ignored"; footer caption analysis id ("reply id — use with review command"); 🏳️→⚪; CLI list empty/error copy + header row; --no-llm help; workspace YAML: bindings.yaml header comment, prs.yaml header comment (commit ranges), requirements_index.yaml → sources.yaml (with back-compat read), revision comment, issues/ README stub; README: drop "for production agents" ambiguity, remove "digestion", gloss "binding gate"/"ladder", "First light"→"First results", "retroactive sweep"→"replay of recent commits" on first mention.

Cross-cutting: vocabulary lives in 4 places (intent.html, onboard.html, render.py, cli.py) — renames must touch all four.
