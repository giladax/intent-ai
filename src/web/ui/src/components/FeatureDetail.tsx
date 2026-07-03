import { useState, useEffect, useCallback } from "react";
import {
  fetchFeatureDetail,
  fetchFeatureFiles,
  addFeatureFile,
  removeFeatureFile,
} from "../api";
import type { FeatureDetail as FeatureDetailType, FeatureFile } from "../types";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Plus } from "lucide-react";

interface Props {
  featureId: string | null;
  onSessionClick?: (sessionId: string) => void;
}

export function FeatureDetail({ featureId, onSessionClick }: Props) {
  const [detail, setDetail] = useState<FeatureDetailType | null>(null);
  const [files, setFiles] = useState<FeatureFile[]>([]);
  const [newGlob, setNewGlob] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFiles = useCallback((id: string) => {
    fetchFeatureFiles(id).then(setFiles).catch(() => setFiles([]));
  }, []);

  useEffect(() => {
    if (!featureId) {
      setDetail(null);
      setFiles([]);
      return;
    }
    fetchFeatureDetail(featureId)
      .then((d) => {
        setDetail(d);
        setFiles(d.files ?? []);
      })
      .catch(() => setDetail(null));
    loadFiles(featureId);
  }, [featureId, loadFiles]);

  const addGlob = async () => {
    if (!featureId || !newGlob.trim()) return;
    setBusy(true);
    try {
      const row = await addFeatureFile(featureId, newGlob.trim());
      setFiles((prev) => [row, ...prev]);
      setNewGlob("");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const removeGlob = async (fileId: string) => {
    if (!featureId) return;
    setBusy(true);
    try {
      await removeFeatureFile(featureId, fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  if (!featureId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="ink-deck">Select a feature to read its dossier.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="ink-kicker">The dossier</div>
        <Skeleton className="mt-3 h-8 w-48" />
        <Skeleton className="mt-6 h-20 w-full" />
      </div>
    );
  }

  const f = detail.feature;
  const constraints = f.constraints ?? [];
  const knownUnknowns = f.known_unknowns ?? [];
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const understandingLines = (f.current_understanding ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      {/* masthead */}
      <header>
        <div className="ink-kicker ink-rise" style={{ "--i": 0 } as React.CSSProperties}>Feature dossier</div>
        <h1 className="ink-masthead ink-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>{f.name}</h1>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        {f.description && (
          <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>{f.description}</p>
        )}
      </header>

      {/* Current Understanding — the served product, so it reads as prose */}
      <section className="ink-rise mt-10" style={{ "--i": 3 } as React.CSSProperties}>
        <h3 className="ink-section">Current understanding</h3>
        {understandingLines.length > 0 ? (
          <ul className="ink-prose mt-4">
            {understandingLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="ink-deck mt-4">
            Nothing yet — approve observations in Review and the understanding assembles here.
          </p>
        )}
      </section>

      {/* Constraints — red ink; these are what agents must respect */}
      {constraints.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 4 } as React.CSSProperties}>
          <h3 className="ink-section">Constraints — served to every agent that enters</h3>
          <div className="mt-4 space-y-3">
            {constraints.map((c, i) => (
              <div key={i} className="ink-note">
                <div className="ink-note-label">constraint</div>
                <p className="ink-note-text">{c}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Known Unknowns — open questions */}
      {knownUnknowns.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 5 } as React.CSSProperties}>
          <h3 className="ink-section">Known unknowns</h3>
          <div className="mt-4 space-y-3">
            {knownUnknowns.map((u, i) => (
              <div key={i} className="ink-note ink-note--plain">
                <div className="ink-note-label">open question</div>
                <p className="ink-note-text">{u}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Evidence Sessions */}
      {detail.sessions.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 6 } as React.CSSProperties}>
          <h3 className="ink-section">Evidence — {detail.sessions.length} session{detail.sessions.length === 1 ? "" : "s"}</h3>
          <div className="ink-ledger mt-4">
            {detail.sessions.map((s) => (
              <button key={s.id} className="ink-ledger-row" onClick={() => onSessionClick?.(s.id)}>
                <span className="ink-ledger-meta w-12 shrink-0">{formatDate(s.startedAt)}</span>
                <span className="ink-ledger-title min-w-0 flex-1" style={{ fontSize: "0.95rem" }}>
                  {s.narrativeSummary || s.sessionShape || "Session"}
                </span>
                <span className="ink-ledger-meta">
                  {s.role ? `${s.role} · ` : ""}
                  {s.momentCount} moment{s.momentCount === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Feature↔File Map */}
      <section className="ink-rise mt-10" style={{ "--i": 7 } as React.CSSProperties}>
        <h3 className="ink-section">File map — {files.length} glob{files.length === 1 ? "" : "s"}</h3>
        <p className="ink-chrome mt-3 italic">
          Longest glob wins; this is how <code>brain.enter(file)</code> finds the feature.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input
            className="ink-input"
            value={newGlob}
            onChange={(e) => setNewGlob(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addGlob();
            }}
            placeholder="e.g. src/web/**"
          />
          <button className="ink-stamp ink-stamp--approve inline-flex items-center gap-1" disabled={busy || !newGlob.trim()} onClick={addGlob}>
            <Plus className="size-3" /> Add
          </button>
        </div>
        <div className="mt-2">
          {files.map((file) => (
            <div key={file.id} className="group flex items-center gap-2 border-b py-1.5" style={{ borderColor: "var(--j-hairline)" }}>
              <code className="ink-chrome flex-1 truncate">{file.glob}</code>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                disabled={busy}
                onClick={() => removeGlob(file.id)}
              >
                <Trash2 className="size-3.5" style={{ color: "var(--j-faint)" }} />
              </button>
            </div>
          ))}
          {files.length === 0 && (
            <p className="ink-chrome mt-2 italic">No globs yet — add one to map files to this feature.</p>
          )}
        </div>
      </section>
    </div>
  );
}
