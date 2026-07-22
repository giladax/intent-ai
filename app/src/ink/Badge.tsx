import type { Ink } from "./vocab";
import { INK_VARS } from "./vocab";

/** A verdict badge — plain label, painted by its ink. The label text comes
 *  pre-translated (from /api/vocab or the enriched needs-you contract); this
 *  component never invents wording. */
export function VerdictBadge({ label, ink }: { label: string; ink: Ink | string }) {
  const vars = INK_VARS[(ink as Ink)] ?? INK_VARS.gray;
  return (
    <span className="ink-badge" style={{ color: vars.fg, background: vars.bg }}>
      {label}
    </span>
  );
}

/** The status dot used in the tree and list rows. */
export function Dot({ ink }: { ink: Ink | string }) {
  return <span className={`dot d-${ink}`} />;
}
