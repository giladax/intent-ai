import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { fetchOrg, fetchNeedsYou, type Org, type RepoCard } from "../api";
import { fetchFeatures } from "../api";
import type { Feature } from "../types";
import { loadVocab, inkForVerdict, type VocabPayload } from "../ink/vocab";
import { Dot } from "../ink/Badge";
import { AddRepo } from "../surfaces/AddRepo";
import { useChatDockOptional } from "../chat-dock";
import { MessageSquare } from "lucide-react";

/** The familiar shell: topbar + left nav + repo▸feature tree. Every room
 *  renders inside it. The nav mirrors the ruled IA; the tree is org > repos >
 *  (features where known). Data is O0's /api/org plus the journal features. */
export function Shell({ children, detail = false }: { children: React.ReactNode; detail?: boolean }) {
  const [org, setOrg] = useState<Org | null>(null);
  const [needsYouCount, setNeedsYouCount] = useState(0);
  const [featureCount, setFeatureCount] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [vocab, setVocab] = useState<VocabPayload | null>(null);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  // Bumped when add-repo completes so the tree re-fetches and shows the new repo.
  const [orgKey, setOrgKey] = useState(0);

  useEffect(() => {
    loadVocab().then(setVocab);
    fetchOrg().then(setOrg).catch(() => setOrg(null));
    fetchNeedsYou().then((n) => setNeedsYouCount(n.length)).catch(() => setNeedsYouCount(0));
    // feature + session counts feed the nav; fail-quiet.
    fetch("/api/features").then((r) => (r.ok ? r.json() : [])).then((f: unknown[]) => setFeatureCount(f.length)).catch(() => {});
    fetch("/api/sessions").then((r) => (r.ok ? r.json() : [])).then((s: unknown[]) => setSessionCount(s.length)).catch(() => {});
  }, [orgKey]);

  return (
    <div className="ink-app" data-detail={detail ? "true" : "false"}>
      <Topbar orgName={org?.name} />
      <aside className="ink-sidebar">
        <nav>
          <NavItem to="/" icon="☀" label="Today" end />
          <NavItem to="/needs-you" icon="◧" label="Needs you" badge={needsYouCount || undefined} />
          <NavItem to="/features" icon="◇" label="Features" count={featureCount ?? undefined} />
          <NavItem to="/repositories" icon="▤" label="Repositories" count={org?.repos.length} />
          <NavItem to="/reviews" icon="⧉" label="Reviews" />
          <NavItem to="/sessions" icon="◴" label="Sessions" count={sessionCount ?? undefined} />
          <NavItem to="/journal" icon="✎" label="Journal" />
          <NavItem to="/channels" icon="◑" label="Channels" />
        </nav>

        <div className="ink-sec">
          Repositories
          <button className="add" title="Add a repository" onClick={() => setAddRepoOpen(true)}>+</button>
        </div>
        {org?.repos.map((r) => (
          <RepoTreeNode key={r.workspace} repo={r} vocab={vocab} />
        ))}
      </aside>
      {children}
      {addRepoOpen && (
        <AddRepoModal
          onDone={() => {
            setAddRepoOpen(false);
            setOrgKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/** The add-repo flow in a familiar modal sheet over the shell. */
function AddRepoModal({ onDone }: { onDone: () => void }) {
  return (
    <div className="add-repo-overlay" onClick={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <div className="add-repo-sheet">
        <div className="add-repo-sheet-header">
          <button className="add-repo-close" onClick={onDone} aria-label="Close">×</button>
        </div>
        <AddRepo onDone={onDone} />
      </div>
    </div>
  );
}

function Topbar({ orgName }: { orgName?: string }) {
  return (
    <div className="ink-topbar">
      <div className="ink-brand">
        <span className="mark" />
        Quire
      </div>
      <div className="ink-org-switch">
        {orgName ?? "Quire"} <span className="chev">▾</span>
      </div>
      <div className="ink-search">
        <span>🔎</span> Search the org — features, promises, PRs, sessions…
        <span className="k">⌘K</span>
      </div>
      <div className="ink-topright">
        <ChatDockOpener />
        <span>?</span>
        <div className="ink-avatar">G</div>
      </div>
    </div>
  );
}

/** The Correspondence opener in the masthead — parked since A0, now live.
 *  Toggles the always-mounted chat dock; the dock keeps its conversation. */
function ChatDockOpener() {
  const dock = useChatDockOptional();
  if (!dock) return null; // no dock mounted (isolated render) — nothing to open
  const { toggleDock, open } = dock;
  return (
    <button
      className={`ink-dock-opener${open ? " active" : ""}`}
      onClick={() => toggleDock()}
      title="Open the Correspondence (⌘J)"
      aria-label="Open the Correspondence"
    >
      <MessageSquare size={16} />
    </button>
  );
}

function NavItem({
  to, icon, label, badge, count, end,
}: {
  to: string; icon: string; label: string; badge?: number; count?: number; end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `ink-nav-item${isActive ? " active" : ""}`}>
      <span className="ic">{icon}</span> {label}
      {badge != null && badge > 0 && <span className="nav-badge">{badge}</span>}
      {count != null && badge == null && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

/** One repo in the tree — expandable to its known features. */
function RepoTreeNode({ repo, vocab }: { repo: RepoCard; vocab: VocabPayload | null }) {
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const location = useLocation();
  const ink = inkForVerdict(vocab, repo.latest_verdict);

  useEffect(() => {
    if (open && features === null) {
      // Features are keyed by project id; the demo repos share workspace==id.
      fetchFeatures(repo.workspace).then(setFeatures).catch(() => setFeatures([]));
    }
  }, [open, features, repo.workspace]);

  const active = location.pathname === `/repo/${repo.workspace}`;

  return (
    <>
      <div className={`ink-tree-item${active ? " sel" : ""}`}>
        <button
          className="caret"
          aria-label={open ? "collapse" : "expand"}
          onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        >
          {open ? "▾" : "▸"}
        </button>
        <Dot ink={ink} />
        <NavLink to={`/repo/${repo.workspace}`} className="nm" style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
          {repo.display_name}
          {repo.status === "watched" && " · watched"}
        </NavLink>
      </div>
      {open && features && features.length > 0 && features.map((f) => (
        <NavLink key={f.id} to={`/feature/${f.id}`} className="ink-tree-child">
          <Dot ink="gray" />
          <span className="nm">{f.name}</span>
        </NavLink>
      ))}
      {open && features && features.length === 0 && (
        <div className="ink-tree-child" style={{ opacity: 0.6, cursor: "default" }}>
          <span className="nm">no features yet</span>
        </div>
      )}
    </>
  );
}
