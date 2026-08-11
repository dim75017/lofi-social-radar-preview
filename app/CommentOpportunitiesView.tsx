"use client";

/* eslint-disable @next/next/no-img-element -- platform logos and live social previews use public assets. */

import { useEffect, useMemo, useState } from "react";

import {
  commentOpportunityRankScore,
  rankCommentOpportunities,
  type CommentOpportunity,
  type CommentOpportunityFeed,
  type CommentOpportunityTone,
  type CommentOpportunityPlatform,
} from "../lib/comment-opportunities";

type PlatformFilter = CommentOpportunityPlatform | "all";
type OpportunitySort = "priority" | "recent";
type QueueFilter = "pending" | "done" | "skipped";
type QueueState = Exclude<QueueFilter, "pending">;

const COMMENT_QUEUE_STORAGE_KEY = "lofi-social-radar:comment-opportunity-statuses:v1";

const PLATFORM_OPTIONS: Array<{
  key: PlatformFilter;
  label: string;
  logo: string | null;
}> = [
  { key: "all", label: "Toutes", logo: null },
  { key: "youtube", label: "YouTube", logo: "platforms/youtube.svg" },
  { key: "instagram", label: "Instagram", logo: "platforms/instagram.svg" },
  { key: "tiktok", label: "TikTok", logo: "platforms/tiktok.svg" },
  { key: "x", label: "X", logo: "platforms/x.svg" },
];

const TONE_META: Record<CommentOpportunityTone, { label: string; marker: string }> = {
  funny: { label: "Drôle", marker: "☺" },
  smart: { label: "Smart", marker: "✦" },
  complice: { label: "Complice", marker: "↳" },
};

const STATUS_META: Record<CommentOpportunity["status"], { label: string; className: string }> = {
  surging: { label: "Accélère", className: "surging" },
  hot: { label: "À saisir", className: "hot" },
  watch: { label: "À surveiller", className: "watch" },
};

export function CommentOpportunitiesView({
  feed,
  loading,
  error,
}: {
  feed: CommentOpportunityFeed | null;
  loading: boolean;
  error: string;
}) {
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [sort, setSort] = useState<OpportunitySort>("priority");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("pending");
  const [queueStates, setQueueStates] = useState<Record<string, QueueState>>({});
  const [queueReady, setQueueReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(COMMENT_QUEUE_STORAGE_KEY);
        const value = stored ? JSON.parse(stored) as Record<string, unknown> : {};
        const next: Record<string, QueueState> = {};
        for (const [id, state] of Object.entries(value)) {
          if (state === "done" || state === "skipped") next[id] = state;
        }
        setQueueStates(next);
      } catch {
        setQueueStates({});
      } finally {
        setQueueReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!queueReady) return;
    try {
      window.localStorage.setItem(COMMENT_QUEUE_STORAGE_KEY, JSON.stringify(queueStates));
    } catch {
      // The queue remains usable in memory when browser storage is unavailable.
    }
  }, [queueReady, queueStates]);

  const ranked = useMemo(
    () => rankCommentOpportunities(feed?.opportunities ?? [], feed?.capturedAt),
    [feed?.capturedAt, feed?.opportunities],
  );
  const counts = useMemo(() => {
    const result = { pending: 0, done: 0, skipped: 0 };
    for (const opportunity of ranked) {
      const state = queueStates[opportunity.id] ?? "pending";
      result[state] += 1;
    }
    return result;
  }, [queueStates, ranked]);
  const visibleOpportunities = useMemo(() => {
    const filtered = ranked.filter((opportunity) => {
      const state = queueStates[opportunity.id] ?? "pending";
      return (platformFilter === "all" || opportunity.platform === platformFilter) && state === queueFilter;
    });
    if (sort === "recent") {
      return filtered.toSorted((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt));
    }
    return filtered;
  }, [platformFilter, queueFilter, queueStates, ranked, sort]);

  const updateQueue = (id: string, state: QueueState | "pending") => {
    setQueueStates((current) => {
      if (state === "pending") {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: state };
    });
  };

  const refreshLabel = feed ? formatRefreshDate(feed.capturedAt) : null;
  const coveredPlatforms = feed?.sourceChecks.filter((item) => item.status !== "failed").length ?? 0;

  return (
    <div className="comment-opportunities-view">
      <header className="comment-feed-heading">
        <div>
          <span className="section-kicker">Veille virale · toutes les 6 heures</span>
          <h2>Commentaires à poster maintenant</h2>
          <p>Une vidéo qui prend, trois réactions Lofi Girl prêtes à copier. Rien n’est publié automatiquement.</p>
        </div>
        {feed && refreshLabel ? (
          <span className="comment-snapshot-pill">
            {refreshLabel} · {feed.opportunities.length} vidéos · {coveredPlatforms}/4 réseaux
          </span>
        ) : null}
      </header>

      <div className="comment-feed-toolbar">
        <div className="comment-platform-tabs" role="group" aria-label="Filtrer les commentaires par plateforme">
          {PLATFORM_OPTIONS.map((option) => (
            <button
              className={platformFilter === option.key ? "active" : ""}
              type="button"
              aria-pressed={platformFilter === option.key}
              onClick={() => setPlatformFilter(option.key)}
              key={option.key}
            >
              {option.logo ? <img src={option.logo} alt="" /> : <span aria-hidden="true">◆</span>}
              {option.label}
            </button>
          ))}
        </div>
        <div className="comment-sort-tabs" role="group" aria-label="Trier les opportunités de commentaires">
          <button className={sort === "priority" ? "active" : ""} type="button" aria-pressed={sort === "priority"} onClick={() => setSort("priority")}>Potentiel</button>
          <button className={sort === "recent" ? "active" : ""} type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Plus récents</button>
        </div>
      </div>

      <div className="comment-queue-tabs" role="tablist" aria-label="État de la file de commentaires">
        <button className={queueFilter === "pending" ? "active" : ""} type="button" role="tab" aria-selected={queueFilter === "pending"} onClick={() => setQueueFilter("pending")}>À commenter <b>{counts.pending}</b></button>
        <button className={queueFilter === "done" ? "active" : ""} type="button" role="tab" aria-selected={queueFilter === "done"} onClick={() => setQueueFilter("done")}>Faits <b>{counts.done}</b></button>
        <button className={queueFilter === "skipped" ? "active" : ""} type="button" role="tab" aria-selected={queueFilter === "skipped"} onClick={() => setQueueFilter("skipped")}>Passés <b>{counts.skipped}</b></button>
      </div>

      {error ? (
        <div className="trend-feed-notice" role="status">
          <span aria-hidden="true">⚠</span>
          <p>{feed ? "La dernière veille reste affichée ; l’actualisation a échoué." : error}</p>
        </div>
      ) : null}

      {loading && !feed ? (
        <div className="trend-feed-loading" role="status">
          <span aria-hidden="true">⏳</span>
          <div><b>Lecture des vidéos qui percent</b><p>Les opportunités les plus commentables sont en cours de classement.</p></div>
        </div>
      ) : visibleOpportunities.length ? (
        <div className="post-grid top-ranking-grid comment-opportunity-grid">
          {visibleOpportunities.map((opportunity, index) => (
            <CommentOpportunityCard
              opportunity={opportunity}
              rank={index + 1}
              referenceAt={feed?.capturedAt ?? opportunity.capturedAt}
              queueState={queueStates[opportunity.id] ?? "pending"}
              onQueueChange={(state) => updateQueue(opportunity.id, state)}
              key={opportunity.id}
            />
          ))}
        </div>
      ) : feed ? (
        <div className="empty-state comment-feed-empty">
          <span aria-hidden="true">✓</span>
          <h3>{queueFilter === "pending" ? "La file est vide" : "Rien dans cette vue"}</h3>
          <p>{queueFilter === "pending" ? "Les prochaines opportunités arriveront au prochain scan." : "Change de plateforme ou reviens à la file active."}</p>
          {queueFilter !== "pending" ? <button className="button secondary" type="button" onClick={() => setQueueFilter("pending")}>Voir les commentaires à faire</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function CommentOpportunityCard({
  opportunity,
  rank,
  referenceAt,
  queueState,
  onQueueChange,
}: {
  opportunity: CommentOpportunity;
  rank: number;
  referenceAt: string;
  queueState: QueueFilter;
  onQueueChange: (state: QueueState | "pending") => void;
}) {
  const [activeTone, setActiveTone] = useState<CommentOpportunityTone>("funny");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const suggestion = opportunity.comments.find((comment) => comment.tone === activeTone) ?? opportunity.comments[0];
  const status = STATUS_META[opportunity.status];
  const metrics = opportunityMetrics(opportunity);
  const potentialScore = commentOpportunityRankScore(opportunity, referenceAt);

  const copySuggestion = async () => {
    const copied = suggestion ? await copyCommentText(suggestion.text) : false;
    setCopyState(copied ? "copied" : "error");
    window.setTimeout(() => setCopyState("idle"), 2200);
  };

  return (
    <article className={`social-post-card comment-opportunity-card has-media status-${status.className}`}>
      <CommentOpportunityMedia opportunity={opportunity} rank={rank} />
      <div className="post-card-body comment-opportunity-body">
        <div className="comment-card-meta-line">
          <span><img src={`platforms/${opportunity.platform}.svg`} alt="" /> {opportunity.author}</span>
          <span className="comment-card-badges">
            {opportunity.risk.level === "medium" ? (
              <span className="comment-review-badge" title={opportunity.risk.note}>À relire</span>
            ) : null}
            <span className={`comment-hot-badge ${status.className}`}>{status.label}</span>
          </span>
        </div>

        <div className="post-card-title comment-source-title">
          <div>
            <span>Potentiel {potentialScore}/100</span>
            <h3><a href={opportunity.url} target="_blank" rel="noreferrer">{opportunity.title || opportunity.caption}</a></h3>
          </div>
        </div>

        <div className="comment-tone-tabs" role="group" aria-label={`Choisir un ton pour ${opportunity.title}`}>
          {opportunity.comments.map((comment) => {
            const tone = TONE_META[comment.tone];
            const isActive = comment.tone === suggestion?.tone;
            return (
              <button className={isActive ? "active" : ""} type="button" aria-pressed={isActive} onClick={() => { setActiveTone(comment.tone); setCopyState("idle"); }} key={comment.tone}>
                <span aria-hidden="true">{tone.marker}</span> {comment.label || tone.label}
              </button>
            );
          })}
        </div>

        {suggestion ? <blockquote className="comment-suggestion">{suggestion.text}</blockquote> : null}

        <button className="comment-copy-button" type="button" onClick={() => void copySuggestion()} aria-live="polite">
          {copyState === "copied" ? "✓ Commentaire copié" : copyState === "error" ? "Copie impossible" : "Copier le commentaire"}
        </button>

        <footer>
          <span className="post-card-footer-metrics" aria-label="Performances visibles">
            {metrics.map((metric) => <span key={metric.label} title={metric.label}>{metric.icon} <b>{formatCompactNumber(metric.value)}</b></span>)}
          </span>
          {opportunity.publishedAt ? <time className="post-published-date" dateTime={opportunity.publishedAt}>{formatCardDate(opportunity.publishedAt)}</time> : <span />}
          <span className="post-card-actions comment-card-actions">
            <a href={opportunity.url} target="_blank" rel="noreferrer">Ouvrir ↗</a>
            {queueState === "pending" ? (
              <>
                <button className="comment-done-button" type="button" onClick={() => onQueueChange("done")}>✓ Fait</button>
                <button className="comment-skip-button" type="button" onClick={() => onQueueChange("skipped")}>Passer</button>
              </>
            ) : <button type="button" onClick={() => onQueueChange("pending")}>Remettre</button>}
          </span>
        </footer>
      </div>
    </article>
  );
}

function CommentOpportunityMedia({ opportunity, rank }: { opportunity: CommentOpportunity; rank: number }) {
  const [playing, setPlaying] = useState(false);
  const embedUrl = commentOpportunityEmbedUrl(opportunity);
  const thumbnail = commentOpportunityThumbnail(opportunity);

  return (
    <div className={`post-visual comment-opportunity-visual platform-${opportunity.platform} ${playing ? "is-playing" : "is-playable"}`}>
      {playing && embedUrl ? (
        <div className="inline-video-frame">
          <iframe
            src={embedUrl}
            title={`Vidéo de ${opportunity.author}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <button className="inline-player-close" type="button" aria-label="Fermer la vidéo" onClick={() => setPlaying(false)}>×</button>
        </div>
      ) : (
        <button className="post-visual-trigger" type="button" onClick={() => embedUrl ? setPlaying(true) : window.open(opportunity.url, "_blank", "noopener,noreferrer")} aria-label={`Lire la vidéo de ${opportunity.author}`}>
          {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : (
            <span className="comment-preview-placeholder" aria-hidden="true">
              <img src={`platforms/${opportunity.platform}.svg`} alt="" />
              <small>Voir la vidéo</small>
            </span>
          )}
          <span className="media-play-mark" aria-hidden="true">▶</span>
        </button>
      )}
      <span className="post-rank">#{rank}</span>
      {opportunity.durationSeconds !== null ? <span className="trend-duration-badge">{formatDuration(opportunity.durationSeconds)}</span> : null}
    </div>
  );
}

function commentOpportunityEmbedUrl(opportunity: CommentOpportunity) {
  try {
    const url = new URL(opportunity.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (opportunity.platform === "instagram") {
      const match = path.match(/^\/(?:reel|reels)\/([^/]+)$/i);
      return match ? `https://www.instagram.com/reel/${match[1]}/embed/` : null;
    }
    if (opportunity.platform === "tiktok") {
      const match = path.match(/^\/@[^/]+\/video\/(\d{12,24})$/i);
      return match ? `https://www.tiktok.com/player/v1/${match[1]}?autoplay=0&controls=1&description=0&music_info=0&rel=0` : null;
    }
    if (opportunity.platform === "youtube") {
      const shorts = path.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/i);
      const watchId = url.searchParams.get("v");
      const id = shorts?.[1] ?? watchId;
      return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&playsinline=1&rel=0` : null;
    }
    const match = path.match(/^\/[^/]+\/status\/(\d+)$/i);
    return match ? `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}&theme=dark&dnt=true` : null;
  } catch {
    return null;
  }
}

function commentOpportunityThumbnail(opportunity: CommentOpportunity) {
  if (opportunity.thumbnailUrl) return opportunity.thumbnailUrl;
  if (opportunity.platform !== "youtube") return null;
  try {
    const url = new URL(opportunity.url);
    const id = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/i)?.[1] ?? url.searchParams.get("v");
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

function opportunityMetrics(opportunity: CommentOpportunity) {
  return [
    opportunity.metrics.views !== null ? { icon: "▶", label: "vues", value: opportunity.metrics.views } : null,
    opportunity.metrics.likes !== null ? { icon: opportunity.platform === "youtube" ? "👍" : "♥", label: "likes", value: opportunity.metrics.likes } : null,
    opportunity.metrics.comments !== null ? { icon: "💬", label: "commentaires", value: opportunity.metrics.comments } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: number }>;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCardDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatRefreshDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDuration(value: number) {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function copyCommentText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
