import { useState, useEffect, useCallback } from "react";
import {
  fetchFeatureDetail,
  fetchFeatureFiles,
  addFeatureFile,
  removeFeatureFile,
} from "../api";
import type { FeatureDetail as FeatureDetailType, FeatureFile } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Plus, FileQuestion, ShieldAlert, BookOpen } from "lucide-react";

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
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a feature to see its understanding
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-2xl p-6 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const f = detail.feature;
  const constraints = f.constraints ?? [];
  const knownUnknowns = f.known_unknowns ?? [];
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <div className="max-w-2xl p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{f.name}</h2>
        {f.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">{f.description}</p>
        )}
      </div>

      {/* Current Understanding */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen className="size-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current Understanding
          </h3>
        </div>
        {f.current_understanding ? (
          <Card className="p-3">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{f.current_understanding}</p>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No understanding yet. Approve observations in the Review Queue to build it.
          </p>
        )}
      </div>

      {/* Constraints */}
      {constraints.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-3.5 text-amber-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Constraints
            </h3>
          </div>
          <div className="space-y-1">
            {constraints.map((c, i) => (
              <Card key={i} className="p-2.5 border-amber-500/30">
                <p className="text-sm leading-relaxed">{c}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Known Unknowns */}
      {knownUnknowns.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileQuestion className="size-3.5 text-purple-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Known Unknowns
            </h3>
          </div>
          <div className="space-y-1">
            {knownUnknowns.map((u, i) => (
              <Card key={i} className="p-2.5 border-purple-500/30">
                <p className="text-sm leading-relaxed">{u}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Sessions */}
      {detail.sessions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence Sessions ({detail.sessions.length})
          </h3>
          <div className="space-y-1">
            {detail.sessions.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 py-2 px-3 rounded hover:bg-accent/50 ${
                  onSessionClick ? "cursor-pointer" : ""
                }`}
                onClick={() => onSessionClick?.(s.id)}
              >
                <span className="text-xs text-muted-foreground shrink-0 w-12">
                  {formatDate(s.startedAt)}
                </span>
                <span className="text-sm truncate flex-1">
                  {s.narrativeSummary || s.sessionShape || "Session"}
                </span>
                {s.role && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {s.role}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  {s.momentCount} moments
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature↔File Map management */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          File Map ({files.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          Globs that resolve to this feature (longest-glob-wins). Used by{" "}
          <code className="font-mono">brain.enter(file)</code>.
        </p>
        <div className="flex gap-2">
          <Input
            value={newGlob}
            onChange={(e) => setNewGlob(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addGlob();
            }}
            placeholder="e.g. src/web/**"
            className="text-sm font-mono"
          />
          <Button size="sm" disabled={busy || !newGlob.trim()} onClick={addGlob}>
            <Plus className="size-3.5 mr-1" /> Add
          </Button>
        </div>
        <div className="space-y-1">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent/50 group"
            >
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded flex-1 truncate">
                {file.glob}
              </code>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 opacity-0 group-hover:opacity-100"
                disabled={busy}
                onClick={() => removeGlob(file.id)}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {files.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No globs yet. Add one to map files to this feature.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
