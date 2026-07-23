import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  saveIntentSource,
  draftHandoff,
  approveHandoff,
  fetchOrg,
  fetchWorkspaceTasks,
  type HandoffTask,
  type HandoffDraftResult,
  type Org,
  type TaskDept,
} from "../api";
import { SigningBlock } from "../ink/SigningBlock";

// ── Department metadata ───────────────────────────────────────────────

const DEPT_META: Record<
  TaskDept,
  { title: string; color: string; bg: string; abbr: string; closureLabel: string }
> = {
  dev: {
    title: "Development — what to build",
    color: "var(--accent)",
    bg: "var(--accent-soft)",
    abbr: "DEV",
    closureLabel: "Closes when a check shows this promise kept",
  },
  qa: {
    title: "QA — what to test",
    color: "var(--green)",
    bg: "var(--green-bg)",
    abbr: "QA",
    closureLabel: "Closes when test inspection detects covering tests",
  },
  product: {
    title: "Product — what to verify",
    color: "var(--amber)",
    bg: "var(--amber-bg)",
    abbr: "PM",
    closureLabel: "Closes manually with a note (evidence detection coming)",
  },
  bi: {
    title: "BI — what to measure",
    color: "var(--gray)",
    bg: "var(--gray-bg)",
    abbr: "BI",
    closureLabel: "Closes manually with a note (evidence detection coming)",
  },
};

const DEPT_ORDER: TaskDept[] = ["dev", "qa", "product", "bi"];

// ── Flow state machine ────────────────────────────────────────────────

type Door = "write" | "upload";
type Stage =
  | "door"          // choose: write or upload
  | "editor"        // write a PRD in the editor
  | "upload"        // paste / drag an existing PRD
  | "saving"        // saving the PRD to the workspace
  | "drafting"      // live LLM grounding + proposals
  | "review"        // review grounded task cards
  | "signing"       // the signing act
  | "done"          // tasks are live
  | "error";

// ── Workspace picker ─────────────────────────────────────────────────

interface WorkspacePickerProps {
  org: Org | null;
  value: string;
  onChange: (ws: string) => void;
}
function WorkspacePicker({ org, value, onChange }: WorkspacePickerProps) {
  return (
    <div className="hf-ws-row">
      <label className="hf-ws-label">Repository workspace</label>
      {org && org.repos.length > 0 ? (
        <select
          className="hf-ws-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose a repo…</option>
          {org.repos.map((r) => (
            <option key={r.workspace} value={r.workspace}>
              {r.display_name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="hf-ws-input"
          type="text"
          placeholder="workspace slug (e.g. intent-ai)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

// ── The main surface ─────────────────────────────────────────────────

/** The Handoff surface — A4.5.
 *  Two doors: write a PRD in-app (authoring) or upload/paste an existing one
 *  (migration). Same analyzer path. The show: promise cards → sign →
 *  grounded task cards by department → the signing act → tasks appear on the
 *  feature page and in Needs-you. */
export function Handoff() {
  const { ws: wsParam } = useParams<{ ws?: string }>();
  const navigate = useNavigate();

  const [org, setOrg] = useState<Org | null>(null);
  const [workspace, setWorkspace] = useState(wsParam ?? "");
  const [stage, setStage] = useState<Stage>("door");
  const [door, setDoor] = useState<Door>("write");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<HandoffDraftResult | null>(null);
  const [decisions, setDecisions] = useState<
    Map<string, { accept: boolean; statement: string }>
  >(new Map());
  const [revealedCount, setRevealedCount] = useState(0);
  const [signing, setSigning] = useState(false);
  // The workspace's existing tasks — the settled week (open/closed) and any
  // proposed handoff awaiting signature (the Needs-you "Sign →" landing).
  const [existingTasks, setExistingTasks] = useState<HandoffTask[] | null>(null);
  const sourceRefRef = useRef<string>("");
  const handoffIdRef = useRef<string>("");

  useEffect(() => {
    fetchOrg()
      .then(setOrg)
      .catch(() => setOrg(null));
  }, []);

  // On the door stage, load the workspace's existing tasks so the settled
  // week is visible and a proposed handoff can be resumed for signing.
  useEffect(() => {
    if (stage !== "door" || !workspace) { setExistingTasks(null); return; }
    let cancelled = false;
    fetchWorkspaceTasks(workspace)
      .then((r) => { if (!cancelled) setExistingTasks(r.tasks); })
      .catch(() => { if (!cancelled) setExistingTasks(null); });
    return () => { cancelled = true; };
  }, [stage, workspace]);

  /** Resume a proposed (unsigned) handoff — the Needs-you "Sign →" path. */
  const resumeProposed = useCallback((tasks: HandoffTask[]) => {
    if (tasks.length === 0) return;
    handoffIdRef.current = tasks[0].handoff_id;
    const initDecisions = new Map<string, { accept: boolean; statement: string }>();
    for (const t of tasks) initDecisions.set(t.task_id, { accept: true, statement: t.statement });
    setDecisions(initDecisions);
    setDraft({ handoff_id: tasks[0].handoff_id, tasks, notes: [] });
    setStage("review");
  }, []);

  // Once we have draft tasks, stagger their reveal.
  useEffect(() => {
    if (stage !== "review" || !draft) return;
    setRevealedCount(0);
    const total = draft.tasks.length;
    if (total === 0) return;
    let i = 0;
    const tick = () => {
      i += 1;
      setRevealedCount(i);
      if (i < total) {
        setTimeout(tick, 120);
      }
    };
    // Small initial delay — let the transition settle before cards drop.
    const t = setTimeout(tick, 300);
    return () => clearTimeout(t);
  }, [stage, draft]);

  const handleChooseDoor = (d: Door) => {
    setDoor(d);
    setStage(d === "write" ? "editor" : "upload");
  };

  const handleSaveAndDraft = useCallback(async () => {
    if (!workspace) { setError("Choose a workspace first."); return; }
    if (!content.trim()) { setError("The PRD can't be empty."); return; }
    setError(null);
    setStage("saving");
    try {
      const saved = await saveIntentSource(workspace, content.trim(), title || undefined);
      sourceRefRef.current = saved.reference;
      setStage("drafting");
      // First try scoped to the new PRD (works once its promises are signed).
      let result = await draftHandoff(workspace, saved.reference);
      if (!result.handoff_id) {
        // A freshly saved PRD is a DRAFT source — its promises aren't signed
        // yet, so the handoff honestly serves the workspace's signed contract
        // instead, and says so. Nothing governs without the approval act.
        const fallback = await draftHandoff(workspace);
        if (fallback.handoff_id) {
          result = {
            ...fallback,
            notes: [
              "Your PRD is saved as a draft source awaiting approval — " +
                "these tasks serve the promises the workspace has already signed.",
              ...fallback.notes,
            ],
          };
        }
      }
      if (!result.handoff_id) {
        // No signed promises anywhere — the system honestly says so.
        setError(
          result.notes.join(" ") ||
            "No signed promises found — sign the contract first, then run the handoff.",
        );
        setStage("error");
        return;
      }
      handoffIdRef.current = result.handoff_id;
      const initDecisions = new Map<string, { accept: boolean; statement: string }>();
      for (const t of result.tasks) {
        initDecisions.set(t.task_id, { accept: true, statement: t.statement });
      }
      setDecisions(initDecisions);
      setDraft(result);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }, [workspace, content, title]);

  const handleSign = useCallback(
    async ({ name, role }: { name: string; role: string }) => {
      if (!handoffIdRef.current) return;
      setSigning(true);
      try {
        const taskDecisions = Array.from(decisions.entries()).map(([task_id, d]) => ({
          task_id,
          accept: d.accept,
          statement: d.statement,
        }));
        await approveHandoff(
          handoffIdRef.current,
          role ? `${name} (${role})` : name,
          taskDecisions,
        );
        setStage("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStage("error");
      } finally {
        setSigning(false);
      }
    },
    [decisions],
  );

  const acceptedCount = Array.from(decisions.values()).filter((d) => d.accept).length;

  const byDept = draft
    ? DEPT_ORDER.reduce(
        (acc, d) => {
          acc[d] = draft.tasks.filter((t) => t.department === d);
          return acc;
        },
        {} as Record<TaskDept, HandoffTask[]>,
      )
    : ({} as Record<TaskDept, HandoffTask[]>);

  return (
    <main className="ink-main hf-main">
      <div className="ink-crumb">
        <b>Quire</b>
        <span className="sep">/</span>
        {workspace ? (
          <>
            <Link to={`/repo/${workspace}`} style={{ color: "inherit", textDecoration: "none" }}>
              {workspace}
            </Link>
            <span className="sep">/</span>
          </>
        ) : null}
        Handoff
      </div>

      {/* ─── Door choice ─── */}
      {stage === "door" && (
        <div className="hf-door">
          <div className="hf-door-head">
            <div className="hf-kicker">The handoff</div>
            <h1 className="hf-h1">A PRD becomes the team's week</h1>
            <p className="hf-deck">
              Author a new PRD or bring an existing one. The system reads what the
              org already has — features, code, contracts — and hands each department
              exactly what it needs to run. Nobody writes a ticket.
            </p>
          </div>

          <WorkspacePicker org={org} value={workspace} onChange={setWorkspace} />

          <div className="hf-doors">
            <button
              className="hf-door-card"
              onClick={() => handleChooseDoor("write")}
              disabled={!workspace}
            >
              <div className="hf-door-icon">✎</div>
              <div className="hf-door-title">Write a PRD</div>
              <div className="hf-door-desc">
                Author intent in the editor. It becomes a first-class source the
                analyzer reads going forward.
              </div>
            </button>

            <button
              className="hf-door-card"
              onClick={() => handleChooseDoor("upload")}
              disabled={!workspace}
            >
              <div className="hf-door-icon">⇪</div>
              <div className="hf-door-title">Paste or upload an existing one</div>
              <div className="hf-door-desc">
                Migrate a Notion export, a Google Doc paste, a .md file. Same analyzer
                path — the content governs immediately once you sign.
              </div>
            </button>
          </div>

          {!workspace && (
            <div className="hf-door-hint">Choose a repository workspace above to continue.</div>
          )}

          {/* A drafted handoff awaiting the signing act — Needs-you lands here. */}
          {(() => {
            const proposed = (existingTasks ?? []).filter((t) => t.status === "proposed");
            if (proposed.length === 0) return null;
            return (
              <div className="hf-resume">
                <div className="hf-resume-text">
                  <b>A handoff awaits your signature</b> — {proposed.length} proposed task
                  {proposed.length !== 1 ? "s" : ""} paused at the signing act.
                </div>
                <button className="ink-btn primary" onClick={() => resumeProposed(proposed)}>
                  Review & sign →
                </button>
              </div>
            );
          })()}

          {/* The settled week — what this workspace's signed handoff looks like now. */}
          {(existingTasks ?? []).some((t) => t.status !== "proposed") && (
            <SignedWeek
              tasks={(existingTasks ?? []).filter((t) => t.status !== "proposed")}
            />
          )}
        </div>
      )}

      {/* ─── Write editor ─── */}
      {(stage === "editor" || stage === "upload") && (
        <div className="hf-editor-wrap">
          <div className="hf-editor-head">
            <h1 className="hf-h1">
              {stage === "editor" ? "Write the PRD" : "Paste the PRD"}
            </h1>
            <p className="hf-deck">
              {stage === "editor"
                ? "Write what the feature should do. Plain language. The system extracts the promises."
                : "Paste the content of your existing PRD — Markdown, plain text, or RST all work."}
            </p>
          </div>

          <div className="hf-title-row">
            <label className="hf-label">Document title</label>
            <input
              className="hf-input"
              type="text"
              placeholder={stage === "editor" ? "e.g. Refund Policy v2" : "e.g. Dashboard PRD"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="hf-editor-area-wrap">
            <label className="hf-label">
              {stage === "editor" ? "Content" : "Paste here"}
            </label>
            <textarea
              className="hf-editor"
              placeholder={
                stage === "editor"
                  ? "# Feature name\n\nUsers must be able to…\n\nThe system shall…"
                  : "Paste your PRD content here…"
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={18}
              spellCheck
              autoFocus
            />
            <div className="hf-char-count">{content.length} characters</div>
          </div>

          <WorkspacePicker org={org} value={workspace} onChange={setWorkspace} />

          <div className="hf-editor-actions">
            <button
              className="ink-btn"
              onClick={() => { setStage("door"); setContent(""); setTitle(""); }}
            >
              ← Back
            </button>
            <button
              className="ink-btn primary hf-run-btn"
              onClick={handleSaveAndDraft}
              disabled={!content.trim() || !workspace}
            >
              Save & generate the handoff
            </button>
          </div>
        </div>
      )}

      {/* ─── Saving ─── */}
      {stage === "saving" && (
        <HandoffProgress
          title="Saving the PRD…"
          note="Writing to the workspace's intent directory."
        />
      )}

      {/* ─── Drafting ─── */}
      {stage === "drafting" && (
        <HandoffProgress
          title="Assembling the handoff…"
          note="Reading the org's features, code, and contracts — then drafting task cards for each department. This takes about a minute."
          detail
        />
      )}

      {/* ─── Review — the show ─── */}
      {stage === "review" && draft && (
        <div className="hf-review">
          <div className="hf-review-head">
            <div className="hf-kicker">Handoff ready</div>
            <h1 className="hf-h1">
              This PRD just became your team's week
            </h1>
            <p className="hf-deck">
              {draft.tasks.length} task{draft.tasks.length !== 1 ? "s" : ""} across{" "}
              {DEPT_ORDER.filter((d) => byDept[d]?.length).length} departments. Each knows
              why it exists, what it builds on, and what closes it. Accept, edit, or
              reject each card — then sign.
            </p>
          </div>

          {draft.notes.length > 0 && (
            <div className="hf-notes">
              {draft.notes.map((n, i) => (
                <div key={i} className="hf-note">{n}</div>
              ))}
            </div>
          )}

          {/* Department groups — staged reveal */}
          {DEPT_ORDER.filter((d) => byDept[d]?.length > 0).map((dept) => {
            const tasks = byDept[dept];
            const meta = DEPT_META[dept];
            // Count how many of this dept's tasks have been "revealed" so far.
            const deptOffset = DEPT_ORDER.slice(
              0,
              DEPT_ORDER.indexOf(dept),
            ).reduce((sum, d2) => sum + (byDept[d2]?.length ?? 0), 0);
            const deptRevealCount = Math.max(0, revealedCount - deptOffset);

            return (
              <div key={dept} className="hf-dept">
                <div className="hf-dept-header" style={{ "--dept-color": meta.color } as React.CSSProperties}>
                  <span className="hf-dept-abbr" style={{ background: meta.bg, color: meta.color }}>
                    {meta.abbr}
                  </span>
                  <span className="hf-dept-title">{meta.title}</span>
                  <span className="hf-dept-count">{tasks.length}</span>
                </div>

                {tasks.map((task, idx) => {
                  const revealed = idx < deptRevealCount;
                  const d = decisions.get(task.task_id) ?? {
                    accept: true,
                    statement: task.statement,
                  };
                  return (
                    <TaskCard
                      key={task.task_id}
                      task={task}
                      meta={meta}
                      revealed={revealed}
                      accept={d.accept}
                      statement={d.statement}
                      onToggle={() =>
                        setDecisions((prev) => {
                          const next = new Map(prev);
                          next.set(task.task_id, { ...d, accept: !d.accept });
                          return next;
                        })
                      }
                      onEdit={(s) =>
                        setDecisions((prev) => {
                          const next = new Map(prev);
                          next.set(task.task_id, { ...d, statement: s });
                          return next;
                        })
                      }
                    />
                  );
                })}
              </div>
            );
          })}

          {/* The signing ceremony */}
          {revealedCount >= draft.tasks.length && (
            <div className="hf-signing-wrap">
              <div className="hf-signing-rule" />
              <div className="hf-signing-context">
                <div className="hf-signing-prompt-head">The signing act</div>
                <p className="hf-signing-copy">
                  You are signing {acceptedCount} task
                  {acceptedCount !== 1 ? "s" : ""} — each tied to a promise, each
                  carrying its receipt. Machines proposed; you decide. Nothing governs
                  without your name.
                </p>
              </div>
              <SigningBlock
                actLabel="make this the team's week"
                prompt={`Sign ${acceptedCount} task${acceptedCount !== 1 ? "s" : ""} — they'll appear on the feature page and in Needs-you.`}
                onSign={handleSign}
                disabled={acceptedCount === 0 || signing}
                disabledHint={acceptedCount === 0 ? "Accept at least one task to sign." : undefined}
                busy={signing}
              />
            </div>
          )}
        </div>
      )}

      {/* ─── Done ─── */}
      {stage === "done" && (
        <div className="hf-done">
          <div className="hf-done-mark">✓</div>
          <h1 className="hf-h1">The team's week is live</h1>
          <p className="hf-deck">
            {acceptedCount} task{acceptedCount !== 1 ? "s" : ""} signed and ready. They appear
            on the feature page and in Needs-you. Dev tasks close when a check shows the
            promise kept; QA when tests are detected; product and BI close manually with
            a note — labeled honestly.
          </p>
          <div className="hf-done-actions">
            {workspace && (
              <Link
                to={`/repo/${workspace}`}
                className="ink-btn primary"
                style={{ textDecoration: "none" }}
              >
                See the repo →
              </Link>
            )}
            <button
              className="ink-btn"
              onClick={() => navigate("/needs-you")}
            >
              Needs you →
            </button>
            <button
              className="ink-btn"
              onClick={() => {
                setStage("door");
                setContent("");
                setTitle("");
                setDraft(null);
                setDecisions(new Map());
                setRevealedCount(0);
                sourceRefRef.current = "";
                handoffIdRef.current = "";
              }}
            >
              Another handoff
            </button>
          </div>
        </div>
      )}

      {/* ─── Error ─── */}
      {stage === "error" && (
        <div className="hf-error">
          <h1 className="hf-h1">Something went wrong</h1>
          <p className="hf-error-msg">{error}</p>
          <button
            className="ink-btn"
            onClick={() => { setStage("door"); setError(null); }}
          >
            ← Start over
          </button>
        </div>
      )}
    </main>
  );
}

// ── Task card — one proposed unit of work ────────────────────────────

interface TaskCardProps {
  task: HandoffTask;
  meta: (typeof DEPT_META)[TaskDept];
  revealed: boolean;
  accept: boolean;
  statement: string;
  onToggle: () => void;
  onEdit: (s: string) => void;
}

function TaskCard({ task, meta, revealed, accept, statement, onToggle, onEdit }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const serveLink = task.links.find((l) => l.kind === "serves_promise");
  const buildLinks = task.links.filter((l) => l.kind === "builds_on_feature" || l.kind === "touches_file");
  const closedBy = task.links.find((l) => l.kind === "closed_by_check");

  return (
    <div
      className={`hf-task${accept ? "" : " hf-task--rejected"}${revealed ? " hf-task--revealed" : ""}`}
    >
      <div className="hf-task-top">
        <button
          className={`hf-task-toggle${accept ? " hf-task-toggle--on" : ""}`}
          onClick={onToggle}
          style={accept ? { background: meta.bg, color: meta.color, borderColor: meta.color } : {}}
          aria-label={accept ? "Reject this task" : "Accept this task"}
        >
          {accept ? "Accept" : "Reject"}
        </button>
        <textarea
          className="hf-task-stmt"
          value={statement}
          onChange={(e) => onEdit(e.target.value)}
          disabled={!accept}
          rows={2}
          aria-label="Task statement"
        />
      </div>

      {task.why && accept && (
        <div className="hf-task-why">{task.why}</div>
      )}

      {/* Receipts — expand on demand */}
      {accept && (serveLink || buildLinks.length > 0 || task.grounding_note || closedBy) && (
        <div className="hf-task-receipts">
          <button
            className="hf-receipt-toggle"
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "Hide receipts ▲" : "Show receipts ▾"}
          </button>

          {expanded && <ReceiptBody task={task} />}
        </div>
      )}
    </div>
  );
}

/** The receipts of one task — Serves (quote) / Builds on / Honest gap /
 *  what closes it. Shared by the proposal card and the settled-week card:
 *  one treatment, everywhere. */
function ReceiptBody({ task }: { task: HandoffTask }) {
  const serveLink = task.links.find((l) => l.kind === "serves_promise");
  const buildLinks = task.links.filter(
    (l) => l.kind === "builds_on_feature" || l.kind === "touches_file",
  );
  const closedBy = task.links.find((l) => l.kind === "closed_by_check");

  return (
    <div className="hf-receipt-body">
      {serveLink && (
        <div className="hf-receipt-row">
          <span className="hf-receipt-label">Serves</span>
          <span className="hf-receipt-val">
            {serveLink.target_label || serveLink.target_ref}
            {serveLink.evidence && (
              <blockquote className="hf-receipt-quote">"{serveLink.evidence}"</blockquote>
            )}
          </span>
        </div>
      )}

      {buildLinks.map((l, i) => (
        <div key={i} className="hf-receipt-row">
          <span className="hf-receipt-label">Builds on</span>
          <span className="hf-receipt-val">{l.evidence || l.target_label}</span>
        </div>
      ))}

      {task.grounding_note && (
        <div className="hf-receipt-row hf-receipt-row--gap">
          <span className="hf-receipt-label">Honest gap</span>
          <span className="hf-receipt-val">{task.grounding_note}</span>
        </div>
      )}

      {closedBy ? (
        <div className="hf-receipt-row hf-receipt-row--closure">
          <span className="hf-receipt-label">Closed on</span>
          <span className="hf-receipt-val">
            Check evidence — {closedBy.target_label || closedBy.target_ref}
          </span>
        </div>
      ) : (
        <div className="hf-receipt-row hf-receipt-row--closure">
          <span className="hf-receipt-label">Closes</span>
          <span className="hf-receipt-val hf-receipt-closure-label">
            {DEPT_META[task.department].closureLabel}
          </span>
        </div>
      )}

      {task.signed_by && (
        <div className="hf-receipt-row">
          <span className="hf-receipt-label">Signed by</span>
          <span className="hf-receipt-val">{task.signed_by}</span>
        </div>
      )}
    </div>
  );
}

// ── The settled week — signed tasks, read-only, grouped by department ─

/** The signed week as it stands: open and closed tasks grouped by
 *  department, each a sentence with its receipts on demand. Read-only —
 *  the signing already happened; this is the record. */
function SignedWeek({ tasks }: { tasks: HandoffTask[] }) {
  const openCount = tasks.filter((t) => t.status === "open").length;
  const closedCount = tasks.filter((t) => t.status === "closed").length;

  return (
    <div className="hf-week">
      <div className="hf-week-head">
        <div className="hf-kicker">The signed week</div>
        <div className="hf-week-sub">
          {tasks.length} signed task{tasks.length !== 1 ? "s" : ""}
          {openCount > 0 && <> · {openCount} open</>}
          {closedCount > 0 && <> · {closedCount} closed on evidence or note</>}
          . Every one serves a signed promise and carries its receipts.
        </div>
      </div>
      {DEPT_ORDER.filter((d) => tasks.some((t) => t.department === d)).map((dept) => {
        const meta = DEPT_META[dept];
        const deptTasks = tasks.filter((t) => t.department === dept);
        return (
          <div key={dept} className="hf-dept">
            <div className="hf-dept-header">
              <span className="hf-dept-abbr" style={{ background: meta.bg, color: meta.color }}>
                {meta.abbr}
              </span>
              <span className="hf-dept-title">{meta.title}</span>
              <span className="hf-dept-count">{deptTasks.length}</span>
            </div>
            {deptTasks.map((t) => (
              <SignedTaskCard key={t.task_id} task={t} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SignedTaskCard({ task }: { task: HandoffTask }) {
  const [expanded, setExpanded] = useState(false);
  const closedBy = task.links.find((l) => l.kind === "closed_by_check");

  return (
    <div className={`hf-task hf-task--revealed hf-task--settled${task.status === "closed" ? " hf-task--closed" : ""}`}>
      <div className="hf-task-top">
        <span
          className={`hf-week-status hf-week-status--${task.status}`}
          aria-label={task.status === "closed" ? "Closed" : "Open"}
        >
          {task.status === "closed" ? "✓" : "☐"}
        </span>
        <span className="hf-task-stmt hf-task-stmt--static">{task.statement}</span>
      </div>
      {task.why && <div className="hf-task-why hf-task-why--settled">{task.why}</div>}
      {task.status === "closed" && closedBy && (
        <div className="hf-week-closed-line">
          Closed on evidence — check <span className="hf-footnote">{closedBy.target_ref}</span>
        </div>
      )}
      {task.closure_note && task.status === "closed" && !closedBy && (
        <div className="hf-week-closed-line">{task.closure_note}</div>
      )}
      <div className="hf-task-receipts hf-task-receipts--settled">
        <button className="hf-receipt-toggle" onClick={() => setExpanded((x) => !x)}>
          {expanded ? "Hide receipts ▲" : "Show receipts ▾"}
        </button>
        {expanded && <ReceiptBody task={task} />}
      </div>
    </div>
  );
}

// ── Progress indicator ────────────────────────────────────────────────

function HandoffProgress({
  title,
  note,
  detail = false,
}: {
  title: string;
  note: string;
  detail?: boolean;
}) {
  return (
    <div className="hf-progress">
      <div className="hf-progress-spinner" aria-hidden />
      <div className="hf-progress-text">
        <strong>{title}</strong>
        <span>{note}</span>
        {detail && (
          <span className="hf-progress-detail">
            The org's features, code, and contracts are being read so every task
            carries a real receipt — not a guess.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Repo-scoped view: tasks for a workspace ──────────────────────────

/** The "work" section for a workspace — tasks linked to this repo's feature.
 *  Mounted inside the RepoPage right rail or as a standalone section. */
export function WorkspaceTasks({
  workspace,
  featureId,
}: {
  workspace: string;
  featureId?: string;
}) {
  const [tasks, setTasks] = useState<HandoffTask[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWorkspaceTasks(workspace)
      .then((r) => {
        let ts = r.tasks;
        // If scoped to a feature, filter by serves_promise links or just show all.
        if (featureId) {
          const linked = ts.filter((t) =>
            t.links.some((l) => l.target_ref === featureId),
          );
          ts = linked.length > 0 ? linked : ts;
        }
        setTasks(ts);
        setLoading(false);
      })
      .catch(() => { setTasks([]); setLoading(false); });
  }, [workspace, featureId]);

  if (loading) return <div className="hf-work-loading">Loading tasks…</div>;
  if (!tasks || tasks.length === 0) return null;

  const open = tasks.filter((t) => t.status === "open");
  const proposed = tasks.filter((t) => t.status === "proposed");
  const closed = tasks.filter((t) => t.status === "closed");

  return (
    <div className="hf-work">
      <div className="hf-work-h">The work</div>
      <div className="hf-work-counts">
        {open.length > 0 && (
          <span className="hf-work-chip hf-work-chip--open">
            {open.length} open
          </span>
        )}
        {proposed.length > 0 && (
          <span className="hf-work-chip hf-work-chip--proposed">
            {proposed.length} awaiting signature
          </span>
        )}
        {closed.length > 0 && (
          <span className="hf-work-chip hf-work-chip--closed">
            {closed.length} closed
          </span>
        )}
      </div>

      {[...open, ...proposed].slice(0, 6).map((t) => (
        <WorkTaskRow key={t.task_id} task={t} />
      ))}
      {closed.slice(0, 3).map((t) => (
        <WorkTaskRow key={t.task_id} task={t} />
      ))}

      <Link
        to={`/handoff/${workspace}`}
        className="hf-work-new"
        style={{ textDecoration: "none" }}
      >
        + New handoff →
      </Link>
    </div>
  );
}

function WorkTaskRow({ task }: { task: HandoffTask }) {
  const meta = DEPT_META[task.department];
  const closedBy = task.links.find((l) => l.kind === "closed_by_check");

  return (
    <div className={`hf-work-row hf-work-row--${task.status}`}>
      <span
        className="hf-work-dept"
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.abbr}
      </span>
      <div className="hf-work-row-body">
        <div className="hf-work-stmt">{task.statement}</div>
        {task.status === "closed" && closedBy && (
          <div className="hf-work-closed-receipt">
            Closed on evidence — check {closedBy.target_ref}
          </div>
        )}
        {task.status === "proposed" && (
          <div className="hf-work-unsigned">Awaiting your signature</div>
        )}
      </div>
      <span className={`hf-work-status hf-work-status--${task.status}`}>
        {task.status === "closed" ? "✓" : task.status === "proposed" ? "◌" : "☐"}
      </span>
    </div>
  );
}
