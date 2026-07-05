import { useState, useEffect, useCallback } from "react";
import { fetchFeatures, createFeature, fetchStatsOverview } from "../api";
import type { Feature, FeatureMomentum } from "../types";
import { Skeleton } from "@/components/ui/skeleton";
import { MomentumMark } from "./Quality";
import { relDay } from "./quality-util";
import { Plus } from "lucide-react";

interface Props {
  repoId: string | null;
  onFeatureClick: (featureId: string) => void;
}

export function FeaturesPage({ repoId, onFeatureClick }: Props) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [momentum, setMomentum] = useState<Map<string, FeatureMomentum>>(new Map());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // feature motion — the altitude layer (fail-safe chrome)
  useEffect(() => {
    fetchStatsOverview(repoId ?? undefined)
      .then((s) => setMomentum(new Map(s.features.map((f) => [f.featureId, f]))))
      .catch(() => setMomentum(new Map()));
  }, [repoId]);

  const load = useCallback(() => {
    if (!repoId) {
      setFeatures([]);
      return;
    }
    setFeatures(null);
    fetchFeatures(repoId).then(setFeatures).catch(() => setFeatures([]));
  }, [repoId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!repoId || !name.trim()) return;
    setBusy(true);
    try {
      const feat = await createFeature(repoId, name.trim());
      setName("");
      setCreating(false);
      load();
      onFeatureClick(feat.id);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  if (features === null) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="ink-kicker">The atlas</div>
        <Skeleton className="mt-3 h-8 w-40" />
        <Skeleton className="mt-6 h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      <header>
        <div className="ink-rise flex items-baseline justify-between" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="ink-kicker">The atlas — what Quire holds</span>
          <button
            className="ink-stamp ink-stamp--quiet inline-flex items-center gap-1"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus className="size-3" /> New feature
          </button>
        </div>
        <h1 className="ink-masthead ink-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>Features</h1>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>
          The unit understanding converges on — each holds a current understanding, its constraints,
          and the evidence they came from.
        </p>
      </header>

      {creating && (
        <div className="ink-rise mt-6 flex items-center gap-3">
          <input
            className="ink-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="name the feature…"
            autoFocus
          />
          <button className="ink-stamp ink-stamp--approve" disabled={busy || !name.trim()} onClick={create}>
            Create
          </button>
        </div>
      )}

      {features.length === 0 ? (
        <div className="ink-rise mt-16 text-center" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="ink-deck">
            The atlas is empty. Create a feature to start
            <br />
            mapping what Quire understands.
          </p>
        </div>
      ) : (
        <div className="ink-ledger mt-8">
          {features.map((f, i) => (
            <button
              key={f.id}
              className="ink-ledger-row ink-rise"
              style={{ "--i": i + 3 } as React.CSSProperties}
              onClick={() => onFeatureClick(f.id)}
              data-talk
              data-talk-kind="feature"
              data-talk-id={f.id}
              data-talk-label={f.name}
              data-talk-summary={f.description || undefined}
            >
              <div className="min-w-0 flex-1">
                <div className="ink-ledger-title">{f.name}</div>
                {f.description && <div className="ink-ledger-sub mt-0.5">{f.description}</div>}
              </div>
              <span className="flex items-center gap-2.5">
                {(() => {
                  const m = momentum.get(f.id);
                  if (!m) return null;
                  const when = relDay(m.lastActivity);
                  return (
                    <MomentumMark
                      trend={m.trend}
                      detail={`${m.recentEvents} events this fortnight vs ${m.priorEvents} the one before${when ? ` · last active ${when}` : ""}`}
                    />
                  );
                })()}
                <span className="ink-ledger-meta">
                  {f.session_count ?? 0} session{(f.session_count ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
