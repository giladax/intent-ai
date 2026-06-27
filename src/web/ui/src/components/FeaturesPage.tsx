import { useState, useEffect, useCallback } from "react";
import { fetchFeatures, createFeature } from "../api";
import type { Feature } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Boxes } from "lucide-react";

interface Props {
  repoId: string | null;
  onFeatureClick: (featureId: string) => void;
}

export function FeaturesPage({ repoId, onFeatureClick }: Props) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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
      <div className="max-w-2xl p-6 space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Features</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The unit understanding converges on. Each holds Current Understanding, constraints, and
            evidence.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-3.5 mr-1" /> New Feature
        </Button>
      </div>

      {creating && (
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="Feature name"
            className="text-sm"
            autoFocus
          />
          <Button size="sm" disabled={busy || !name.trim()} onClick={create}>
            Create
          </Button>
        </div>
      )}

      {features.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Boxes className="size-8" />
          <p className="text-sm">No features yet. Create one to start mapping understanding.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {features.map((f) => (
            <Card
              key={f.id}
              className="p-4 cursor-pointer hover:bg-accent/40 transition-colors"
              onClick={() => onFeatureClick(f.id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium flex-1 truncate">{f.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {f.session_count} sessions
                </Badge>
              </div>
              {f.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.description}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
