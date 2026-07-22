import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchNeedsYou, type NeedsYouItem } from "../api";
import { VerdictBadge, Dot } from "../ink/Badge";
import { age } from "../ink/age";
import type { Ink } from "../ink/vocab";

/** The Needs-you room: the few decisions awaiting you, biggest stakes first,
 *  quiet when the org is fine — with the selected decision's evidence on the
 *  right. Both panes render from ONE contract (/api/needs-you). */
export function NeedsYou() {
  const [items, setItems] = useState<NeedsYouItem[] | null>(null);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("item");

  useEffect(() => {
    fetchNeedsYou().then(setItems).catch(() => setItems([]));
  }, []);

  // Auto-select the loudest item when nothing is chosen (mock shows the top
  // decision open by default).
  useEffect(() => {
    if (items && items.length > 0 && !selectedId) {
      setParams((p) => { p.set("item", items[0].id); return p; }, { replace: true });
    }
  }, [items, selectedId, setParams]);

  const selected = useMemo(
    () => items?.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  return (
    <>
      <main className="ink-main">
        <div className="ink-crumb"><b>Quire</b> <span className="sep">/</span> Needs you</div>
        <div className="ink-main-head">
          <h1>Needs you</h1>
          <div className="sub">
            {items && items.length > 0
              ? `${items.length} ${items.length === 1 ? "thing needs" : "things need"} you — biggest stakes first.`
              : "Quiet when the org is fine."}
          </div>
        </div>

        {items === null ? (
          <div className="ink-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="ink-empty">
            <div className="big">Nothing needs you</div>
            The org is fine. When a promise breaks or a change needs your call, it lands here.
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className={`ink-row${it.id === selectedId ? " sel" : ""}`}
              onClick={() => setParams((p) => { p.set("item", it.id); return p; })}
            >
              <Dot ink={it.ink as Ink} />
              <VerdictBadge label={it.label} ink={it.ink} />
              <div className="title">
                <div className="t">{it.label} on {it.repo}</div>
                <div className="m">
                  <span>{it.repo}</span> · <span className="mono">PR {it.pr_number}</span>
                </div>
              </div>
              <div className="rt">
                <span className="age">{age(it.ts)}</span>
                <span className="act">Review →</span>
              </div>
            </div>
          ))
        )}
      </main>

      {selected && <NeedsYouDetail item={selected} />}
    </>
  );
}

function NeedsYouDetail({ item }: { item: NeedsYouItem }) {
  return (
    <aside className="ink-detail">
      <div className="ink-detail-head">
        <VerdictBadge label={item.label} ink={item.ink} />
        <h2>{item.label} on {item.repo}</h2>
        <div className="meta">
          <span>{item.repo}</span> · <span className="mono">PR {item.pr_number}</span>
        </div>
      </div>
      <div className="ink-detail-body">
        {item.promise && (
          <>
            <div className="ink-d-sec">The promise it touched</div>
            <div className="ink-promise">
              <div className="p-t">{item.promise.statement || item.promise.obligation_id || "A promise"}</div>
              {item.promise.reasoning && (
                <div
                  className="p-q"
                  style={{ borderLeft: `3px solid var(--${item.ink})`, background: `var(--${item.ink}-bg)` }}
                >
                  {item.promise.reasoning}
                </div>
              )}
              <div className="p-src">
                {item.promise.obligation_id ?? "obligation"}
                {item.promise.relation ? ` · ${item.promise.relation.replace(/_/g, " ")}` : ""}
              </div>
            </div>
          </>
        )}

        {item.why && (
          <>
            <div className="ink-d-sec">Why the author did it</div>
            <div className="ink-consult">
              <span className="ic">◷</span>
              <div>
                {item.why.summary} <a href={item.link}>Open the review →</a>
              </div>
            </div>
          </>
        )}

        <div className="ink-d-sec">Your call</div>
        <div className="ink-actions">
          <a className="ink-btn danger" href={item.link} style={{ textDecoration: "none" }}>Send back</a>
          <a className="ink-btn primary" href={item.link} style={{ textDecoration: "none" }}>Sign off</a>
        </div>
      </div>
    </aside>
  );
}
