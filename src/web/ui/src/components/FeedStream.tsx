// FeedStream — the editorial org overview (THE FEED).
// Now-edge shimmer, masthead, lede (word-by-word first sentence), trending
// story cards with heat ticks, and the press-and-unfold flow: a press
// appends an unfold entry to a list rendered in-stream (declarative — no
// DOM cloning). Each unfold reveals via transitions gated on the .in class.

import { useState, useEffect, useRef } from "react";
import "./FeedStream.css";
import type { FeedComposed, FeedStory } from "../api";
import {
  formatRelativeDate,
  buildEditionLabel,
  avatarColor,
  isAgentInitials,
  storyAccent,
  heatTicks,
} from "./feed-stream-utils";

export interface PressedStory {
  featureId: string;
  featureName: string;
}

interface FeedStreamProps {
  feed: FeedComposed | null;
  loading: boolean;
  /** Sessions digested — shown on the now-edge label. */
  sessionsDigested: number;
  /** Stack of pressed stories, in press order. Rendered in-stream below the cards. */
  pressedStories: PressedStory[];
  onStoryPress: (featureId: string, featureName: string) => void;
  /** Optional notification card rendered before the now-edge (Task 9). */
  notifSlot?: React.ReactNode;
  /** Optional: navigate to a session detail when a citation chip is clicked. */
  onSessionClick?: (sessionId: string) => void;
}

const ACCENT_VAR: Record<string, string> = {
  vermilion: "var(--lc-vermilion)",
  marigold: "var(--lc-marigold)",
  cobalt: "var(--lc-cobalt)",
};

// Kick text color — marigold is too light on paper, mockup uses #B57B14.
const KICK_COLOR: Record<string, string> = {
  vermilion: "var(--lc-vermilion)",
  marigold: "#B57B14",
  cobalt: "var(--lc-cobalt)",
};

/** Split the lede into a headline (first sentence) + the rest.
    Long first sentences break at the em-dash — headlines stay short. */
function splitLede(text: string): { headline: string; rest: string } {
  const m = text.match(/^(.+?[.!?])\s+(.*)$/s);
  let headline = m && m[1].length >= 12 ? m[1] : text;
  let rest = m && m[1].length >= 12 ? m[2] : "";
  if (headline.length > 110) {
    const dash = headline.indexOf(" — ");
    if (dash > 20) {
      rest = headline.slice(dash + 3).replace(/^./, (c) => c.toUpperCase()) + (rest ? " " + rest : "");
      headline = headline.slice(0, dash) + ".";
    }
  }
  return { headline, rest };
}

export function FeedStream({
  feed,
  loading,
  sessionsDigested,
  pressedStories,
  onStoryPress,
  notifSlot,
  onSessionClick,
}: FeedStreamProps) {
  if (loading || !feed) {
    return (
      <div className="feed-stream" aria-busy="true">
        <div className="feed-now-edge" aria-hidden="true">
          <div className="line" />
          <div className="lab"><span>last updated</span><span>…</span></div>
        </div>
        <div className="fs-skel" aria-label="Loading the feed">
          <span /><span />
        </div>
      </div>
    );
  }

  // Use explicit headline field if present; fall back to splitLede for backward compat
  const { headline: splitHeadlineText, rest: splitRest } = splitLede(feed.lede.text);
  const headline = feed.lede.headline ?? splitHeadlineText;
  const rest = feed.lede.headline ? feed.lede.text : splitRest;
  const headlineWords = headline.split(" ");
  const isLongHeadline = headlineWords.length > 8;
  const pressedIds = new Set(pressedStories.map((p) => p.featureId));
  const storyByFeature = new Map(feed.trending.map((s) => [s.featureId, s]));
  const accentByFeature = new Map(
    feed.trending.map((s, i) => [s.featureId, storyAccent(i)]),
  );
  const hasLedeProvenance = feed.lede.citedSessionIds.length > 0;

  return (
    <div className="feed-stream">
      {notifSlot}

      {/* the now edge */}
      <div className="feed-now-edge lc-rise" style={{ animationDelay: "0.5s" }} aria-hidden="true">
        <div className="line" />
        <div className="lab">
          <span>last updated</span>
          <span>
            {formatRelativeDate(feed.composedAt)} · <b>{sessionsDigested} sessions digested</b>
          </span>
        </div>
      </div>

      {/* masthead */}
      <header className="feed-edition lc-rise" style={{ animationDelay: "0.65s" }}>
        <span><span className="k">THE FEED</span> · ORG LENS</span>
        <span>{buildEditionLabel(feed.editionNumber, new Date(feed.composedAt))}</span>
      </header>

      {/* lead: the org overview */}
      <article className="feed-lead">
        <h1 aria-label={headline} data-long={isLongHeadline ? "" : undefined}>
          {headlineWords.map((word, i) => (
            <span key={i}>
              <span className="fs-word" style={{ animationDelay: `${Math.min(0.9 + i * 0.16, 2.8)}s` }}>
                {word}
              </span>
              {i < headlineWords.length - 1 ? " " : ""}
            </span>
          ))}
        </h1>
        {rest && (
          <p
            className="lede lc-rise"
            style={{ animationDelay: `${Math.min(0.9 + headlineWords.length * 0.16, 2.8) + 0.2}s` }}
          >
            {rest}
          </p>
        )}
        <p className="feed-byline lc-rise" style={{ animationDelay: "3s" }}>
          — <b>written by Quire</b> from the recorded sessions
          {hasLedeProvenance && <> · every claim traces to the record</>}
        </p>
      </article>

      {/* trending */}
      {feed.trending.length > 0 && (
        <>
          <div className="feed-trendhead lc-rise" style={{ animationDelay: "3.2s" }}>
            <span className="ember" /> MOST ACTIVE <span className="rule" />
            <span className="note">heat = events, recency-weighted</span>
          </div>

          {feed.trending.map((story, i) => (
            <StoryCard
              key={story.featureId}
              story={story}
              accent={storyAccent(i)}
              index={i}
              pressed={pressedIds.has(story.featureId)}
              onPress={() => onStoryPress(story.featureId, story.featureName)}
            />
          ))}
        </>
      )}

      {feed.trending.length === 0 && (
        <p className="lede lc-rise" style={{ animationDelay: "3.2s", color: "var(--lc-ink-60)" }}>
          Nothing is trending yet — new sessions will surface here as they are digested.
        </p>
      )}

      {/* Briefs register — quick one-liners for context after the main cards */}
      {feed.trending.length > 1 && (
        <div className="feed-briefs lc-rise" style={{ animationDelay: `${3.5 + feed.trending.length * 0.15}s` }}>
          <div className="feed-briefs-head">
            <span className="rule" /> ALSO THIS WEEK <span className="rule" />
          </div>
          {feed.trending.slice(1).map((story) => (
            <button
              key={`brief-${story.featureId}`}
              className="feed-brief-item"
              onClick={() => onStoryPress(story.featureId, story.featureName)}
            >
              <span className="feed-brief-kick">{story.featureName.toUpperCase()}</span>
              <span className="feed-brief-hed">{story.dek.split(/[.!?]/)[0].trim()}.</span>
            </button>
          ))}
        </div>
      )}

      {/* the flow — presses extend the stream here */}
      <div className="fs-flow" aria-live="polite">
        {pressedStories.map((p) => {
          const story = storyByFeature.get(p.featureId);
          if (!story) return null;
          return (
            <UnfoldSection
              key={p.featureId}
              story={story}
              accent={accentByFeature.get(p.featureId) ?? "vermilion"}
              onSessionClick={onSessionClick}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Story card ─────────────────────────────────────────────────────────

function StoryCard({
  story,
  accent,
  index,
  pressed,
  onPress,
}: {
  story: FeedStory;
  accent: string;
  index: number;
  pressed: boolean;
  onPress: () => void;
}) {
  const ticks = heatTicks(story.heatScore);
  const cool = story.heatLabel === "cooling";
  return (
    <button
      className={`feed-story lc-rise${pressed ? " pressed" : ""}`}
      style={{ animationDelay: `${3.35 + index * 0.15}s` }}
      data-accent={accent}
      onClick={onPress}
    >
      <span className="kick" style={{ color: KICK_COLOR[accent] }}>
        <span className="sq" style={{ background: ACCENT_VAR[accent] }} />
        {story.featureName.toUpperCase()} · 48 HOURS
      </span>
      <h2>{story.headline}</h2>
      <p className="dek">{story.dek}</p>
      <span className="foot">
        <span className={`feed-heat${cool ? " cool" : ""}`} aria-hidden="true">
          {ticks.map((h, i) => (
            <i key={i} style={{ height: `${h}px`, animationDelay: `${i * 0.35}s` }} />
          ))}
        </span>
        <span>
          {story.eventCount} events · {story.heatLabel}
        </span>
        {story.actorInitials.length > 0 && (
          <span className="avstack" aria-label={`${story.actorInitials.join(", ")} touched this`}>
            {story.actorInitials.slice(0, 3).map((ini) => (
              <Avatar key={ini} initials={ini} />
            ))}
            {story.actorInitials.length > 3 && (
              <span className="av av--sm av--more">+{story.actorInitials.length - 3}</span>
            )}
          </span>
        )}
        <span className="press">
          {pressed ? (
            <>EXPANDED <span className="ar">●</span> BELOW</>
          ) : (
            <>EXPAND <span className="ar">↓</span></>
          )}
        </span>
      </span>
    </button>
  );
}

// ── Avatar — initials disc, deterministic color, agent mark ────────────

export function Avatar({ initials, size = "sm" }: { initials: string; size?: "sm" | "md" | "lg" }) {
  const agent = isAgentInitials(initials);
  const { background, color } = avatarColor(initials);
  const sizeClass = size === "sm" ? " av--sm" : size === "lg" ? " av--lg" : "";
  return (
    <span
      className={`av${sizeClass}${agent ? " av--agent" : ""}`}
      style={agent ? { background: "var(--lc-ink-60)" } : { background, color }}
      title={initials}
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

// ── Unfold section — the story's deeper cut, appended in-stream ────────

function UnfoldSection({ story, accent, onSessionClick }: { story: FeedStory; accent: string; onSessionClick?: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // Double-rAF: mount first (content in the DOM at base state), then add
    // .in so the staggered transitions play. Declarative — no cloning.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }, 60);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, []);

  return (
    <section
      ref={ref}
      className={`fs-unfold${entered ? " in" : ""}`}
      data-accent={accent}
      aria-label={`${story.featureName} expanded`}
    >
      <div className="fs-stem" aria-hidden="true" />
      <div className="fs-speaker fs-u fs-u1">
        Quire · <span className="fs-scope">{story.featureName.toLowerCase()}</span>
      </div>
      <h3 className="fs-u fs-u2">
        {(story.deepHeadline && story.deepHeadline !== story.headline) ? story.deepHeadline : story.headline}
      </h3>
      {(story.deep || story.dek).split("\n\n").map((para, i) => (
        <p key={i} className="fs-body fs-u fs-u3" style={i > 0 ? { marginTop: "12px" } : undefined}>{para}</p>
      ))}
      <div className="fs-cites fs-u fs-u5">
        <span className="fs-chip">
          <span className="fs-dot" style={{ background: ACCENT_VAR[accent] }} />
          {story.eventCount} events · 48 hours
        </span>
        <span className="fs-chip">
          <span className="fs-dot" style={{ background: "var(--lc-moss)" }} />
          {story.heatLabel}
        </span>
        {story.citedSessionIds.slice(0, 2).map((sid) =>
          onSessionClick ? (
            <button
              key={sid}
              className="fs-chip fs-chip--link"
              onClick={() => onSessionClick(sid)}
              title={`Open session ${sid.slice(0, 8)}`}
            >
              <span className="fs-dot" style={{ background: "var(--lc-ink-40)" }} />
              session {sid.slice(0, 8)}
            </button>
          ) : (
            <span key={sid} className="fs-chip">
              <span className="fs-dot" style={{ background: "var(--lc-ink-40)" }} />
              session {sid.slice(0, 8)}
            </span>
          )
        )}
      </div>
      <div className="fs-ask-turn fs-u fs-u6">
        <div className="fs-speaker" style={{ marginBottom: "10px" }}>Quire · asking</div>
        <p className="fs-q">
          {story.openQuestion}
          <span className="fs-waiting" aria-label="waiting for you"><i /><i /><i /></span>
        </p>
      </div>
      <p className="fs-openline fs-u fs-u7">ask anything below · or expand another story above</p>
    </section>
  );
}
