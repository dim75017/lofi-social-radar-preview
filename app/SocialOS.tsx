"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come from live social sources with dynamic hosts. */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  generateSocialIdeas,
  type SocialIdea,
} from "../lib/social-ideas";
import {
  getFormatFilters,
  getSocialFormatLabel,
  matchesSocialFormatFilter,
  type SocialFormatFilter,
} from "../lib/social-formats";
import {
  SOCIAL_DURATION_FILTERS,
  hasKnownSocialPublishedDate,
  matchesSocialDuration,
  type SocialDurationFilter,
} from "../lib/social-duration";

type Platform = "youtube" | "instagram" | "tiktok" | "x";
type View = "overview" | "top" | "ideas" | "all" | "sources";
type IdeaDecision = "produce" | "rework" | "discard";

type SocialAccount = {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string;
  profile_url: string;
  external_account_id: string | null;
  source_kind: string;
  coverage_label: string;
  status: "ready" | "limited" | "error" | "idle";
  follower_count: number | null;
  last_scan_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  post_count: number;
};

type SocialPost = {
  id: string;
  account_id: string;
  platform: Platform;
  external_post_id: string;
  url: string;
  title: string;
  text: string;
  format: string;
  thumbnail_url: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  poll_votes: number | null;
  performance_score: number | null;
  score_confidence: "high" | "medium" | "low" | "insufficient";
  score_explanation: string;
  analysis_label: string | null;
  source_kind: string;
  first_seen_at: string;
  last_seen_at: string;
  last_metric_at: string;
};

type Insight = {
  emoji: string;
  title: string;
  summary: string;
  evidence?: string;
};

export type WorkspacePayload = {
  mode: "live" | "public-snapshot";
  notice: string;
  generatedAt: string;
  accounts: SocialAccount[];
  posts: SocialPost[];
  scans: unknown[];
  historyCoverage?: Array<{
    platform: Platform;
    scope: string;
    status: string;
    itemCount: number;
    oldestPublishedAt: string | null;
    newestPublishedAt: string | null;
    limitations: string[];
  }>;
  analysis?: {
    insights?: Array<
      Partial<Insight> & {
        title: string;
        detail?: string;
        platform?: Platform | "all";
      }
    >;
    crossPlatform?: Array<{
      label: string;
      platforms: Platform[];
      averageScore: number;
      postIds: string[];
    }>;
  } | null;
};

const PLATFORM_META: Record<
  Platform,
  { emoji: string; label: string; short: string; tone: string }
> = {
  youtube: { emoji: "▶️", label: "YouTube", short: "YT", tone: "red" },
  instagram: { emoji: "📸", label: "Instagram", short: "IG", tone: "pink" },
  tiktok: { emoji: "🎵", label: "TikTok", short: "TT", tone: "cyan" },
  x: { emoji: "𝕏", label: "X", short: "X", tone: "blue" },
};

const NAV: Array<{
  id: View;
  emoji: string;
  label: string;
  group: "Pilotage" | "Données";
}> = [
  { id: "overview", emoji: "📊", label: "Command Center", group: "Pilotage" },
  { id: "top", emoji: "🏆", label: "Meilleurs posts", group: "Pilotage" },
  { id: "ideas", emoji: "💡", label: "Idées à produire", group: "Pilotage" },
  { id: "all", emoji: "🔎", label: "Tous les contenus", group: "Données" },
  { id: "sources", emoji: "🔌", label: "Sources", group: "Données" },
];

const VIEW_COPY: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Command Center",
    subtitle: "Ce qui fonctionne vraiment sur les comptes Lofi Girl.",
  },
  top: {
    title: "Meilleurs posts",
    subtitle: "Classement normalisé par plateforme, métriques et âge du contenu.",
  },
  ideas: {
    title: "Idées à produire",
    subtitle: "Des concepts testables dérivés des signaux qui ressortent vraiment.",
  },
  all: {
    title: "Tous les contenus",
    subtitle: "Les publications réellement détectées, sans donnée de démonstration.",
  },
  sources: {
    title: "Sources officielles",
    subtitle: "Couverture, fraîcheur et limites visibles pour chaque réseau.",
  },
};

const IDEA_DECISIONS_STORAGE_KEY = "lofi-social-radar:idea-decisions:v1";
const POSTS_PAGE_SIZE = 48;
const PLATFORM_ORDER: Platform[] = ["youtube", "instagram", "tiktok", "x"];

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function relativeAge(value: string | null) {
  if (!value) return "date publique absente";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "date inconnue";
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 1) return "moins d’1 h";
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} j`;
  const months = Math.floor(days / 30);
  return `${months} mois`;
}

function confidenceLabel(value: SocialPost["score_confidence"]) {
  if (value === "high") return "Confiance forte";
  if (value === "medium") return "Confiance moyenne";
  if (value === "low") return "Échantillon limité";
  return "Non classé";
}

function scoreTone(score: number | null) {
  if (score === null) return "muted";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "muted";
}

function formatEmptyCopy(platform: Platform, filter: SocialFormatFilter) {
  if (filter === "comment") {
    if (platform === "youtube") {
      return "Les commentaires écrits par @LofiGirl ne sont pas énumérables par auteur via l’API publique. Un export propriétaire YouTube est requis.";
    }
    if (platform === "instagram") {
      return "Les commentaires écrits par @lofigirl nécessitent la connexion du compte professionnel Meta ou un export propriétaire.";
    }
    return "Les commentaires écrits par @lofigirl nécessitent la connexion du compte Business TikTok ou un export propriétaire.";
  }
  if (platform === "instagram") {
    return "La connexion du compte professionnel Meta est nécessaire pour récupérer cet historique sans inventer de données.";
  }
  return "Aucun contenu public classable n’a été trouvé pour ce format dans le relevé actuel.";
}

function postLabel(post: SocialPost) {
  if (post.analysis_label) return post.analysis_label;
  const value = `${post.title} ${post.text}`.toLowerCase();
  if (/radio|beats|music|mix|sleep|study|lofi/.test(value)) return "Musique & usage";
  if (/fortnite|game|album|release|merch|listen/.test(value)) return "Activation";
  if (/pocky|maya|girl|character|lore/.test(value)) return "Personnage & lore";
  if (/tell me|comment|you|your|\?/.test(value)) return "Conversation";
  return "Relatable & humour";
}

function normalizeCreative(post: SocialPost) {
  return `${post.title || post.text}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/#[\w-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 9)
    .join(" ");
}

function localInsights(posts: SocialPost[]): Insight[] {
  if (!posts.length) return [];
  const ranked = [...posts].sort(
    (a, b) => (b.performance_score ?? -1) - (a.performance_score ?? -1),
  );
  const groups = new Map<string, SocialPost[]>();
  for (const post of posts) {
    const key = normalizeCreative(post);
    if (key.split(" ").length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const cross = [...groups.values()]
    .filter((group) => new Set(group.map((post) => post.platform)).size >= 2)
    .sort((a, b) => {
      const average = (items: SocialPost[]) =>
        items.reduce((sum, item) => sum + (item.performance_score ?? 0), 0) / items.length;
      return average(b) - average(a);
    })[0];
  const topFive = ranked.slice(0, Math.min(5, ranked.length));
  const labels = new Map<string, number>();
  for (const post of topFive) {
    const label = postLabel(post);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const dominant = [...labels.entries()].sort((a, b) => b[1] - a[1])[0];
  const top = ranked[0];
  const insights: Insight[] = [];

  if (cross) {
    const platforms = [...new Set(cross.map((post) => PLATFORM_META[post.platform].label))];
    insights.push({
      emoji: "🌍",
      title: "Créatif cross-platform détecté",
      summary: `« ${cross[0].title || cross[0].text} » ressort sur ${platforms.join(", ")}.`,
      evidence: `${cross.length} publications reliées par leur accroche.`,
    });
  }
  insights.push({
    emoji: "🚀",
    title: `${PLATFORM_META[top.platform].label} porte le signal n°1`,
    summary: `« ${top.title || top.text} » est actuellement le post le mieux classé.`,
    evidence: `${top.performance_score ?? "—"}/100 · ${top.score_explanation}`,
  });
  if (dominant) {
    insights.push({
      emoji: "🧠",
      title: `Pattern dominant : ${dominant[0]}`,
      summary: `${dominant[1]} des ${topFive.length} meilleurs posts utilisent ce ressort éditorial.`,
      evidence: "Lecture descriptive de l’échantillon visible, pas une causalité.",
    });
  }
  return insights.slice(0, 3);
}

function metrics(post: SocialPost) {
  return [
    post.views !== null ? { icon: "👁", label: "vues", value: post.views } : null,
    post.likes !== null ? { icon: "♥", label: "likes", value: post.likes } : null,
    post.comments !== null
      ? { icon: "💬", label: "commentaires", value: post.comments }
      : null,
    post.shares !== null ? { icon: "↗", label: "partages", value: post.shares } : null,
    post.saves !== null ? { icon: "🔖", label: "sauvegardes", value: post.saves } : null,
    post.poll_votes !== null
      ? { icon: "🗳️", label: "votes", value: post.poll_votes }
      : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: number }>;
}

function normalizedIdeaPost(post: SocialPost) {
  return {
    platform: post.platform,
    externalId: post.external_post_id,
    url: post.url,
    title: post.title || null,
    text: post.text || null,
    format: post.format || null,
    thumbnailUrl: post.thumbnail_url,
    publishedAt: post.published_at,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.saves,
    raw: null,
  };
}

export function SocialOS({
  initialWorkspace = null,
  previewMode = false,
}: {
  initialWorkspace?: WorkspacePayload | null;
  previewMode?: boolean;
}) {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(initialWorkspace);
  const [view, setView] = useState<View>("overview");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [formatFilter, setFormatFilter] = useState<SocialFormatFilter>("all");
  const [topPlatform, setTopPlatform] = useState<"all" | Platform>("all");
  const [topFormatFilter, setTopFormatFilter] = useState<SocialFormatFilter>("all");
  const [topDuration, setTopDuration] = useState<SocialDurationFilter>("all");
  const [topNavExpanded, setTopNavExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!initialWorkspace);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [postPagination, setPostPagination] = useState({ key: "", count: POSTS_PAGE_SIZE });
  const [ideaDecisions, setIdeaDecisions] = useState<Record<string, IdeaDecision>>({});
  const [ideaDecisionsReady, setIdeaDecisionsReady] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (previewMode) {
      if (initialWorkspace) setWorkspace(initialWorkspace);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const payload = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Le radar ne répond pas.");
      setWorkspace(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [initialWorkspace, previewMode]);

  useEffect(() => {
    if (previewMode || initialWorkspace) return;
    const timeout = window.setTimeout(() => {
      void loadWorkspace();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialWorkspace, loadWorkspace, previewMode]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    let parsed: Record<string, IdeaDecision> = {};
    try {
      const saved = window.localStorage.getItem(IDEA_DECISIONS_STORAGE_KEY);
      if (saved) {
        parsed = JSON.parse(saved) as Record<string, IdeaDecision>;
      }
    } catch {
      // Local decisions are optional; the radar stays usable if storage is blocked.
    }
    const timeout = window.setTimeout(() => {
      setIdeaDecisions(parsed);
      setIdeaDecisionsReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!ideaDecisionsReady) return;
    try {
      window.localStorage.setItem(
        IDEA_DECISIONS_STORAGE_KEY,
        JSON.stringify(ideaDecisions),
      );
    } catch {
      // Keep the in-memory state when the browser refuses local storage.
    }
  }, [ideaDecisions, ideaDecisionsReady]);

  const runScan = async (target?: Platform) => {
      if (previewMode) {
        if (target) {
          setTopPlatform(target);
          setTopFormatFilter("all");
          setTopDuration("all");
          setSearch("");
          setView("top");
          setTopNavExpanded(true);
          setToast(
            `${PLATFORM_META[target].label} · ${workspace?.accounts.find((account) => account.platform === target)?.post_count ?? 0} contenus du snapshot`,
          );
        } else {
          setView("ideas");
          setToast(`Idées recalculées sur ${workspace?.posts.length ?? 0} contenus publics`);
        }
        setMobileOpen(false);
        return;
      }
      setScanning(true);
      setError("");
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(target ? { platform: target } : {}),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || "Le scan a échoué.");
        await loadWorkspace();
        setToast(target ? `${PLATFORM_META[target].label} actualisé` : "Les 4 réseaux ont été rescannés");
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : "Le scan a échoué.");
      } finally {
        setScanning(false);
      }
  };

  const posts = useMemo(() => workspace?.posts ?? [], [workspace?.posts]);
  const accounts = workspace?.accounts ?? [];
  const topPosts = useMemo(
    () => [...posts].sort((a, b) => (b.performance_score ?? -1) - (a.performance_score ?? -1)),
    [posts],
  );
  const searchedTopPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return topPosts;
    return topPosts.filter((post) =>
      `${post.title} ${post.text} ${post.format}`.toLowerCase().includes(needle),
    );
  }, [search, topPosts]);
  const topDurationReference = workspace?.generatedAt ?? "";
  const durationTopPosts = useMemo(
    () =>
      searchedTopPosts.filter((post) =>
        matchesSocialDuration(post, topDuration, topDurationReference),
      ),
    [searchedTopPosts, topDuration, topDurationReference],
  );
  const topPlatformPosts = useMemo(
    () =>
      topPlatform === "all"
        ? durationTopPosts
        : durationTopPosts.filter((post) => post.platform === topPlatform),
    [durationTopPosts, topPlatform],
  );
  const topFilteredPosts = useMemo(
    () =>
      topPlatform === "all" || topFormatFilter === "all"
        ? topPlatformPosts
        : topPlatformPosts.filter((post) =>
            matchesSocialFormatFilter(post, topFormatFilter),
          ),
    [topFormatFilter, topPlatform, topPlatformPosts],
  );
  const topLifetimeFilteredPosts = useMemo(() => {
    const platformPosts =
      topPlatform === "all"
        ? searchedTopPosts
        : searchedTopPosts.filter((post) => post.platform === topPlatform);
    return topPlatform === "all" || topFormatFilter === "all"
      ? platformPosts
      : platformPosts.filter((post) =>
          matchesSocialFormatFilter(post, topFormatFilter),
        );
  }, [searchedTopPosts, topFormatFilter, topPlatform]);
  const topEmptyIsDuration =
    topDuration !== "all" && topLifetimeFilteredPosts.length > 0;
  const topUndatedCount = useMemo(
    () =>
      topDuration === "all"
        ? 0
        : searchedTopPosts.filter((post) => {
            if (topPlatform !== "all" && post.platform !== topPlatform) return false;
            if (
              topPlatform !== "all" &&
              topFormatFilter !== "all" &&
              !matchesSocialFormatFilter(post, topFormatFilter)
            ) {
              return false;
            }
            return !hasKnownSocialPublishedDate(post);
          }).length,
    [searchedTopPosts, topDuration, topFormatFilter, topPlatform],
  );
  const activeTopDuration =
    SOCIAL_DURATION_FILTERS.find((option) => option.key === topDuration) ??
    SOCIAL_DURATION_FILTERS[0];
  const filteredPosts = useMemo(() => {
    return searchedTopPosts.filter((post) => {
      if (platform !== "all" && post.platform !== platform) return false;
      if (platform !== "all" && formatFilter !== "all") {
        return matchesSocialFormatFilter(post, formatFilter);
      }
      return true;
    });
  }, [formatFilter, platform, searchedTopPosts]);
  const insights = useMemo(() => {
    const serverInsights = workspace?.analysis?.insights;
    return serverInsights?.length
      ? serverInsights.slice(0, 3).map((insight) => ({
          emoji:
            insight.emoji ??
            (insight.platform && insight.platform !== "all"
              ? PLATFORM_META[insight.platform].emoji
              : "🧠"),
          title: insight.title,
          summary: insight.summary ?? insight.detail ?? "Analyse descriptive disponible.",
          evidence: insight.evidence,
        }))
      : localInsights(posts);
  }, [posts, workspace?.analysis?.insights]);
  const ideaPlan = useMemo(
    () =>
      generateSocialIdeas(posts.map(normalizedIdeaPost), {
        now: workspace?.generatedAt,
        maxIdeas: 6,
        winnersPerPlatform: 4,
      }),
    [posts, workspace?.generatedAt],
  );
  const paginationKey = `${view}:${platform}:${formatFilter}:${search}`;
  const visiblePostCount =
    postPagination.key === paginationKey ? postPagination.count : POSTS_PAGE_SIZE;
  const visiblePosts = filteredPosts.slice(0, visiblePostCount);

  const chooseTopPlatform = (target: Platform) => {
    setView("top");
    setTopPlatform(target);
    setTopFormatFilter("all");
    setTopNavExpanded(true);
    setMobileOpen(false);
  };

  const setIdeaDecision = useCallback((ideaId: string, decision: IdeaDecision) => {
    setIdeaDecisions((current) => ({ ...current, [ideaId]: decision }));
    const label =
      decision === "produce"
        ? "Ajoutée à produire"
        : decision === "rework"
          ? "Ajoutée à retravailler"
          : "Idée écartée";
    setToast(label);
  }, []);
  const activeSources = accounts.filter((account) => account.post_count > 0).length;
  const lastSuccess = accounts
    .map((account) => account.last_success_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const navCount = (id: View) => {
    if (id === "top") return posts.length;
    if (id === "ideas") return ideaPlan.ideas.length;
    if (id === "all") return posts.length;
    if (id === "sources") return accounts.length;
    return undefined;
  };

  return (
    <div className="app-shell">
      <button
        className="burger"
        type="button"
        aria-label="Ouvrir le menu"
        onClick={() => setMobileOpen(true)}
      >
        ☰
      </button>
      <button
        className={`side-veil ${mobileOpen ? "show" : ""}`}
        type="button"
        aria-label="Fermer le menu"
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            ◉<span />
          </div>
          <div className="brand-copy">
            <h1>
              Lofi <span>Social Radar</span>
            </h1>
            <small>Community Intelligence</small>
          </div>
        </div>

        <div className="radar-switch" aria-label="Produit actif">
          <a
            href="https://dim75017.github.io/youtube-radar-kx9v2m/"
            target="_blank"
            rel="noreferrer"
          >
            ▶ YouTube
          </a>
          <a
            href="https://dim75017.github.io/youtube-radar-kx9v2m/spotify/"
            target="_blank"
            rel="noreferrer"
          >
            ♫ Spotify
          </a>
          <span className="on">● Social</span>
        </div>

        <nav className="nav" aria-label="Navigation principale">
          {(["Pilotage", "Données"] as const).map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {NAV.filter((item) => item.group === group).map((item) => {
                const isTopItem = item.id === "top";
                const isTopSection = isTopItem && view === "top";
                const isActive =
                  view === item.id && (!isTopItem || topPlatform === "all");
                const isSectionActive = isTopSection && topPlatform !== "all";

                return (
                  <div
                    className={`nav-entry ${isTopItem ? "has-children" : ""}`}
                    key={item.id}
                  >
                    <button
                      className={isActive ? "active" : isSectionActive ? "section-active" : ""}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      aria-expanded={isTopItem ? topNavExpanded : undefined}
                      aria-controls={isTopItem ? "top-platform-subnav" : undefined}
                      onClick={() => {
                        if (item.id === "top") {
                          const isCurrentAll = view === "top" && topPlatform === "all";
                          if (isCurrentAll) {
                            setTopNavExpanded((expanded) => !expanded);
                          } else {
                            setView("top");
                            setTopPlatform("all");
                            setTopFormatFilter("all");
                            setTopDuration("all");
                            setSearch("");
                            setTopNavExpanded(true);
                          }
                          return;
                        }

                        setView(item.id);
                        setTopNavExpanded(false);
                        if (item.id === "all") {
                          setPlatform("all");
                          setFormatFilter("all");
                        }
                        setMobileOpen(false);
                      }}
                    >
                      <span className="nav-emoji">{item.emoji}</span>
                      <span className="nav-text">{item.label}</span>
                      {isTopItem ? (
                        <span className="nav-meta">
                          <span className="nav-count">{navCount(item.id)}</span>
                          <span
                            className={`nav-disclosure ${topNavExpanded ? "open" : ""}`}
                            aria-hidden="true"
                          >
                            ⌄
                          </span>
                        </span>
                      ) : navCount(item.id) !== undefined ? (
                        <span className="nav-count">{navCount(item.id)}</span>
                      ) : null}
                    </button>

                    {isTopSection && topNavExpanded ? (
                      <div
                        className="nav-submenu"
                        id="top-platform-subnav"
                        role="group"
                        aria-label="Plateformes des meilleurs posts"
                      >
                        {PLATFORM_ORDER.map((key) => {
                          const meta = PLATFORM_META[key];
                          const count = posts.filter(
                            (post) => post.platform === key,
                          ).length;
                          return (
                            <button
                              className={topPlatform === key ? "active" : ""}
                              type="button"
                              aria-current={topPlatform === key ? "page" : undefined}
                              aria-label={`${meta.label}, ${count} posts`}
                              title={`${meta.label} · ${count} posts`}
                              onClick={() => chooseTopPlatform(key)}
                              key={key}
                            >
                              <span className="nav-emoji">{meta.emoji}</span>
                              <span className="nav-text">{meta.label}</span>
                              <span className="nav-count">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sync-row">
            <span className={`sync-dot ${scanning ? "loading" : error ? "error" : ""}`} />
            <div>
              <b>{scanning ? "Scan en cours" : `${activeSources}/4 sources actives`}</b>
              <span>{lastSuccess ? `Dernier relevé ${formatDate(lastSuccess, true)}` : "Premier scan à lancer"}</span>
            </div>
          </div>
          <button className="refresh-button" type="button" disabled={scanning} onClick={() => void runScan()}>
            {scanning
              ? "⏳ Collecte…"
              : previewMode
                ? "💡 Recalculer les idées"
                : "↻ Scanner les réseaux"}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Social & Community Intelligence OS</span>
            <h2>
              {NAV.find((item) => item.id === view)?.emoji} {VIEW_COPY[view].title}
              <span className="top-pill">{previewMode ? "Public V2" : "Live V2"}</span>
            </h2>
            <p>{VIEW_COPY[view].subtitle}</p>
          </div>
          <div className="top-actions">
            <span className="demo-pill live-pill">
              ● {previewMode ? "Snapshot public interactif" : "Données publiques réelles"}
            </span>
            <button className="button primary" type="button" disabled={scanning} onClick={() => void runScan()}>
              {scanning
                ? "⏳ Scan en cours"
                : previewMode
                  ? "💡 Générer les idées"
                  : "🔄 Scanner maintenant"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <span>⚠️</span>
            <div>
              <b>Le radar a rencontré un problème</b>
              <p>{error}</p>
            </div>
            <button type="button" aria-label="Fermer" onClick={() => setError("")}>×</button>
          </div>
        ) : null}

        {loading && !workspace ? (
          <div className="scanner-loading">
            <div className="radar-loader">◉</div>
            <h3>Scan des comptes officiels Lofi Girl</h3>
            <p>Instagram, X, TikTok et YouTube sont interrogés et normalisés.</p>
            <div className="scan-platforms">📸 &nbsp; 𝕏 &nbsp; 🎵 &nbsp; ▶️</div>
          </div>
        ) : null}

        {workspace && view === "overview" ? (
          <div className="view-stack">
            <section>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Couverture maintenant</span>
                  <h3>{activeSources} réseaux avec des posts exploitables</h3>
                </div>
                <span className="freshness">{posts.length} contenus · relevé {formatDate(lastSuccess ?? null, true)}</span>
              </div>
              <div className="source-status-grid">
                {(Object.keys(PLATFORM_META) as Platform[]).map((key) => {
                  const account = accounts.find((item) => item.platform === key);
                  const meta = PLATFORM_META[key];
                  return (
                    <button
                      type="button"
                      className={`source-status-card tone-${meta.tone}`}
                      key={key}
                      onClick={() => {
                        setTopPlatform(key);
                        setTopFormatFilter("all");
                        setTopDuration("all");
                        setSearch("");
                        setView("top");
                        setTopNavExpanded(true);
                      }}
                    >
                      <span className="source-logo">{meta.emoji}</span>
                      <span className="source-card-copy">
                        <b>{meta.label}</b>
                        <small>{account?.coverage_label ?? "Source en attente"}</small>
                      </span>
                      <span className="source-count">
                        <b>{account?.post_count ?? 0}</b>
                        <small>posts</small>
                      </span>
                      <span className={`source-state ${account?.status ?? "idle"}`}>
                        {account?.status === "error" ? "Erreur" : account?.status === "limited" ? "Limité" : "Actif"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="history-proof">
                <span className="history-proof-icon" aria-hidden="true">🗂️</span>
                <div>
                  <span className="section-kicker">Périmètre historique vérifié</span>
                  <h3>{posts.length} contenus publics actuellement exploitables</h3>
                  <p>
                    <b>{accounts.find((account) => account.platform === "youtube")?.post_count ?? 0} YouTube</b>
                    {" · "}
                    <b>{accounts.find((account) => account.platform === "tiktok")?.post_count ?? 0} TikTok</b>
                    {" · "}
                    <b>{accounts.find((account) => account.platform === "x")?.post_count ?? 0} X</b>.
                    Instagram et l’historique X complet nécessitent la connexion propriétaire ; les contenus privés, supprimés ou non listés ne sont pas inventés.
                  </p>
                </div>
                <button className="button ghost compact" type="button" onClick={() => setView("sources")}>
                  Voir les limites →
                </button>
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Analyse éditoriale</span>
                  <h3>Ce qui mérite l’attention de l’équipe</h3>
                </div>
                <span className="freshness">Calculé sur {posts.length} posts réels</span>
              </div>
              <div className="insight-grid">
                {insights.map((insight, index) => (
                  <article className={`insight-card insight-${index + 1}`} key={`${insight.title}-${index}`}>
                    <span className="insight-emoji">{insight.emoji}</span>
                    <span className="section-kicker">{index === 0 ? "Signal prioritaire" : "Lecture du radar"}</span>
                    <h3>{insight.title}</h3>
                    <p>{insight.summary}</p>
                    {insight.evidence ? <small>{insight.evidence}</small> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="overview-columns social-overview-columns">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="section-kicker">Top performance</span>
                    <h3>Les posts qui fonctionnent le mieux</h3>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setTopPlatform("all");
                      setTopFormatFilter("all");
                      setTopDuration("all");
                      setSearch("");
                      setView("top");
                      setTopNavExpanded(true);
                    }}
                  >
                    Voir tout →
                  </button>
                </div>
                <div className="top-post-list">
                  {topPosts.slice(0, 5).map((post, index) => (
                    <PostRow post={post} rank={index + 1} key={post.id} />
                  ))}
                </div>
              </div>

              <div className="panel methodology-panel">
                <div className="panel-head">
                  <div>
                    <span className="section-kicker">Score explicable</span>
                    <h3>Comparaisons honnêtes</h3>
                  </div>
                  <span className="audit-lock">🔒</span>
                </div>
                <div className="method-list">
                  <div><span>01</span><p><b>Chaque réseau est comparé à lui-même.</b> Les vues TikTok ne sont jamais comparées brutes aux likes Instagram.</p></div>
                  <div><span>02</span><p><b>L’âge du post est intégré quand sa date est publique.</b> Sans date, le radar signale qu’il compare seulement les volumes visibles.</p></div>
                  <div><span>03</span><p><b>Les métriques absentes sont retirées.</b> Elles ne sont jamais remplacées artificiellement par zéro.</p></div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {workspace && view === "ideas" ? (
          <div className="view-stack editorial-ideas-view">
            <div className="ideas-summary">
              <span className="ideas-summary-icon" aria-hidden="true">💡</span>
              <div>
                <span className="section-kicker">Moteur éditorial explicable</span>
                <h3>{ideaPlan.ideas.length} pistes dérivées des posts gagnants</h3>
                <p>
                  Chaque piste cite ses sources et reste une hypothèse à tester — jamais une
                  promesse de performance.
                </p>
              </div>
              <span className="official-assets-pill">🔒 Assets officiels uniquement</span>
            </div>

            {ideaPlan.ideas.length ? (
              <div className="editorial-ideas-list">
                {ideaPlan.ideas.map((idea, index) => (
                  <EditorialIdeaCard
                    idea={idea}
                    index={index + 1}
                    decision={ideaDecisions[idea.id]}
                    onDecision={setIdeaDecision}
                    key={idea.id}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>💡</span>
                <h3>Pas encore assez de signal public</h3>
                <p>Le moteur attend au moins un post classable avant de proposer une idée.</p>
                <button
                  className="button primary"
                  type="button"
                  disabled={scanning}
                  onClick={() => void runScan()}
                >
                  {scanning ? "Scan en cours…" : "Scanner les réseaux"}
                </button>
              </div>
            )}

            <div className="ideas-method-note">
              <span>🧭</span>
              <p>{ideaPlan.caveats[0]} {ideaPlan.caveats[2]}</p>
            </div>
          </div>
        ) : null}

        {workspace && view === "top" ? (
          <div className="view-stack top-platform-view">
            <section
              className={`top-ranking-controls tone-${topPlatform === "all" ? "blue" : PLATFORM_META[topPlatform].tone}`}
              aria-label="Contrôles du classement"
            >
              <div className="top-duration-control-row">
                <span className="section-kicker">Durée</span>
                <div
                  className="format-filter-tabs top-duration-tabs"
                  aria-label="Filtrer le classement par durée"
                >
                  {SOCIAL_DURATION_FILTERS.map((option) => (
                    <button
                      className={topDuration === option.key ? "active" : ""}
                      type="button"
                      aria-pressed={topDuration === option.key}
                      onClick={() => setTopDuration(option.key)}
                      key={option.key}
                    >
                      {option.emoji} {option.label}
                    </button>
                  ))}
                </div>
                <span className="top-ranking-sort">🏆 Meilleure performance d’abord</span>
              </div>

              <div className="top-ranking-control-row">
                <label className="search-box top-ranking-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Chercher une accroche, un format…"
                  />
                </label>

                <span className="top-ranking-count">
                  <b>{topFilteredPosts.length}</b>
                  <small>{activeTopDuration.label} · tous affichés</small>
                </span>
              </div>

              {topPlatform !== "all" ? (
                <div className="top-format-control-row">
                  <span className="section-kicker">
                    Formats {PLATFORM_META[topPlatform].label}
                  </span>
                  <div
                    className="format-filter-tabs top-format-tabs"
                    aria-label={`Formats ${PLATFORM_META[topPlatform].label}`}
                  >
                    {getFormatFilters(topPlatform).map((filter) => {
                      const count = topPlatformPosts.filter((post) =>
                        matchesSocialFormatFilter(post, filter.key),
                      ).length;
                      return (
                        <button
                          className={topFormatFilter === filter.key ? "active" : ""}
                          type="button"
                          aria-pressed={topFormatFilter === filter.key}
                          onClick={() => setTopFormatFilter(filter.key)}
                          key={filter.key}
                        >
                          {filter.emoji} {filter.label} <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="top-ranking-note">
                  Classement continu, de la meilleure performance à la plus faible. Les plateformes se choisissent sous « Meilleurs posts » dans le menu de gauche.
                </p>
              )}

              {topUndatedCount > 0 ? (
                <p className="top-undated-note">
                  ℹ️ {topUndatedCount} post{topUndatedCount > 1 ? "s" : ""} sans date
                  publique {topUndatedCount > 1 ? "restent" : "reste"} disponible{topUndatedCount > 1 ? "s" : ""}
                  uniquement dans All time.
                </p>
              ) : null}
            </section>

            {topFilteredPosts.length ? (
              <div className="post-grid top-ranking-grid">
                {topFilteredPosts.map((post, index) => (
                  <PostCard
                    post={post}
                    rank={index + 1}
                    compact={false}
                    key={post.id}
                  />
                ))}
              </div>
            ) : topPlatform !== "all" ? (
              <div className={`format-empty-state top-ranking-empty tone-${PLATFORM_META[topPlatform].tone}`}>
                <span>{topFormatFilter === "comment" ? "💭" : "📡"}</span>
                <div>
                  <h3>
                    {topEmptyIsDuration
                      ? "Aucun contenu daté dans cette période"
                      : search.trim()
                        ? "Aucun résultat pour cette recherche"
                        : "Aucun contenu disponible pour ce format"}
                  </h3>
                  <p>
                    {topEmptyIsDuration
                      ? "Essaie une durée plus large ou reviens à All time."
                      : search.trim()
                        ? "Essaie une autre accroche ou efface la recherche."
                        : formatEmptyCopy(topPlatform, topFormatFilter)}
                  </p>
                </div>
                <button className="button ghost compact" type="button" onClick={() => setView("sources")}>
                  Voir les limites →
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <span>🔎</span>
                <h3>
                  {topEmptyIsDuration
                    ? "Aucun contenu daté dans cette période"
                    : "Aucun post ne correspond"}
                </h3>
                <p>
                  {topEmptyIsDuration
                    ? "Essaie une durée plus large ou reviens à All time."
                    : "Essaie une autre recherche."}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {workspace && view === "all" ? (
          <div className="view-stack">
            <div className="toolbar social-toolbar">
              <div className="filter-tabs" aria-label="Filtrer par plateforme">
                <button
                  className={platform === "all" ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setPlatform("all");
                    setFormatFilter("all");
                  }}
                >
                  Tous
                </button>
                {PLATFORM_ORDER.map((key) => (
                  <button
                    className={platform === key ? "active" : ""}
                    type="button"
                    key={key}
                    onClick={() => {
                      setPlatform(key);
                      setFormatFilter("all");
                    }}
                  >
                    {PLATFORM_META[key].emoji} {PLATFORM_META[key].label}
                  </button>
                ))}
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Chercher une accroche, un format…" />
              </label>
              <span className="result-count"><b>{filteredPosts.length}</b> contenus</span>
            </div>

            {platform !== "all" ? (
              <div className="format-filter-tabs all-format-filters" aria-label={`Formats ${PLATFORM_META[platform].label}`}>
                {getFormatFilters(platform).map((filter) => (
                  <button
                    className={formatFilter === filter.key ? "active" : ""}
                    type="button"
                    aria-pressed={formatFilter === filter.key}
                    onClick={() => setFormatFilter(filter.key)}
                    key={filter.key}
                  >
                    {filter.emoji} {filter.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="post-list-grid">
              {visiblePosts.map((post, index) => (
                <PostCard post={post} rank={index + 1} compact key={post.id} />
              ))}
            </div>
            {visiblePosts.length < filteredPosts.length ? (
              <div className="progressive-pagination">
                <span>
                  {visiblePosts.length} sur {filteredPosts.length} contenus affichés
                </span>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() =>
                    setPostPagination({
                      key: paginationKey,
                      count: visiblePostCount + POSTS_PAGE_SIZE,
                    })
                  }
                >
                  Afficher {Math.min(POSTS_PAGE_SIZE, filteredPosts.length - visiblePosts.length)} de plus ↓
                </button>
              </div>
            ) : null}
            {!filteredPosts.length ? (
              <div className="empty-state">
                <span>{formatFilter === "comment" ? "💭" : "🔎"}</span>
                <h3>Aucun contenu pour ce filtre</h3>
                <p>
                  {platform === "all"
                    ? "Essaie une autre recherche."
                    : formatEmptyCopy(platform, formatFilter)}
                </p>
                {platform !== "all" ? (
                  <button className="button ghost" type="button" onClick={() => setView("sources")}>
                    Voir les limites →
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {workspace && view === "sources" ? (
          <div className="view-stack">
            <div className="source-notice">
              <span>🛰️</span>
              <div>
                <b>Première base : signaux publics réellement visibles</b>
                <p>Le radar collecte ce que chaque réseau rend public. Les connexions propriétaires ajouteront ensuite portée, watch time, sauvegardes et rétention.</p>
              </div>
            </div>
            <div className="sources-detail-grid">
              {accounts.map((account) => {
                const meta = PLATFORM_META[account.platform];
                const history = workspace.historyCoverage?.find(
                  (item) => item.platform === account.platform,
                );
                return (
                  <article className={`source-detail-card tone-${meta.tone}`} key={account.id}>
                    <div className="source-detail-head">
                      <span className="source-logo large">{meta.emoji}</span>
                      <div>
                        <span className="section-kicker">Compte officiel vérifié</span>
                        <h3>{meta.label} · @{account.handle}</h3>
                      </div>
                      <span className={`source-state ${account.status}`}>{account.status === "error" ? "Erreur" : account.status === "limited" ? "Couverture limitée" : "Actif"}</span>
                    </div>
                    <div className="source-kpis">
                      <div><b>{formatNumber(account.follower_count)}</b><span>abonnés visibles</span></div>
                      <div><b>{account.post_count}</b><span>posts collectés</span></div>
                      <div><b>{formatDate(account.last_success_at, true)}</b><span>dernier succès</span></div>
                    </div>
                    <div className="coverage-box">
                      <span>Couverture</span>
                      <p>{account.coverage_label}</p>
                      {history?.limitations?.length ? (
                        <details className="coverage-limit-details">
                          <summary>
                            Voir les {history.limitations.length} limites de cette source
                          </summary>
                          <ul className="coverage-limit-list">
                            {history.limitations.map((limitation) => (
                              <li key={limitation}>{limitation}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {account.last_error ? <small>Dernière limite : {account.last_error}</small> : null}
                    </div>
                    <div className="source-actions">
                      <a className="button ghost compact" href={account.profile_url} target="_blank" rel="noreferrer">Voir le profil ↗</a>
                      <button className="button primary compact" type="button" disabled={scanning} onClick={() => void runScan(account.platform)}>
                        {previewMode ? `🏆 Voir le top ${meta.label}` : `↻ Scanner ${meta.label}`}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
      </main>

      {toast ? <div className="toast">✅ {toast}</div> : null}
    </div>
  );
}

function EditorialIdeaCard({
  idea,
  index,
  decision,
  onDecision,
}: {
  idea: SocialIdea;
  index: number;
  decision?: IdeaDecision;
  onDecision: (ideaId: string, decision: IdeaDecision) => void;
}) {
  const decisionLabel =
    decision === "produce"
      ? "À produire"
      : decision === "rework"
        ? "À retravailler"
        : decision === "discard"
          ? "Écartée"
          : "À décider";
  const confidence =
    idea.confidence === "high"
      ? "Confiance forte"
      : idea.confidence === "medium"
        ? "Confiance moyenne"
        : "Signal limité";

  return (
    <article className={`editorial-idea-card decision-${decision ?? "none"}`}>
      <header className="editorial-idea-head">
        <div>
          <div className="editorial-idea-meta">
            <span>Idée {String(index).padStart(2, "0")}</span>
            <span>{confidence} · {idea.confidenceScore}/100</span>
            <span className={`idea-decision-status status-${decision ?? "none"}`}>
              {decisionLabel}
            </span>
          </div>
          <h3>{idea.title}</h3>
        </div>
        <div className={`idea-confidence-score confidence-${idea.confidence}`}>
          <b>{idea.confidenceScore}</b>
          <small>/100</small>
        </div>
      </header>

      <div className="editorial-signal-box">
        <span>📡 Signal observé</span>
        <p>{idea.observedSignal.summary}</p>
        <div className="idea-seeds" aria-label="Posts sources">
          {idea.seedPosts.map((seed) => (
            <a
              href={seed.url}
              target="_blank"
              rel="noreferrer"
              title={seed.label}
              key={`${seed.platform}:${seed.externalId}`}
            >
              {PLATFORM_META[seed.platform].emoji} {PLATFORM_META[seed.platform].label}
              <b>{seed.performanceScore}/100</b>
              <span>↗</span>
            </a>
          ))}
        </div>
      </div>

      <div className="idea-concept-grid">
        <div className="idea-concept-block">
          <span>🎬 Format proposé</span>
          <p>{idea.proposedFormat}</p>
        </div>
        <div className="idea-concept-block hook-block">
          <span>🪝 Hook</span>
          <p>« {idea.hook} »</p>
        </div>
      </div>

      <div className="idea-platforms">
        <span className="idea-section-label">Déclinaisons natives</span>
        <div className="idea-platform-grid">
          {(["youtube", "instagram", "tiktok", "x"] as Platform[]).map((platform) => {
            const adaptation = idea.platformAdaptations[platform];
            return (
              <div className={`idea-platform-card tone-${PLATFORM_META[platform].tone}`} key={platform}>
                <b>{PLATFORM_META[platform].emoji} {PLATFORM_META[platform].label}</b>
                <strong>{adaptation.format}</strong>
                <p>{adaptation.execution}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="idea-confidence-note">
        <span>🧪</span>
        <p>{idea.confidenceRationale}</p>
      </div>

      <footer className="editorial-idea-footer">
        <p>🔒 Assets officiels uniquement · {idea.limits[0]}</p>
        <div className="editorial-decision-actions" aria-label="Décision locale">
          <button
            className="decision-button produce"
            type="button"
            aria-pressed={decision === "produce"}
            onClick={() => onDecision(idea.id, "produce")}
          >
            ✅ À produire
          </button>
          <button
            className="decision-button rework"
            type="button"
            aria-pressed={decision === "rework"}
            onClick={() => onDecision(idea.id, "rework")}
          >
            🛠️ À retravailler
          </button>
          <button
            className="decision-button discard"
            type="button"
            aria-pressed={decision === "discard"}
            onClick={() => onDecision(idea.id, "discard")}
          >
            ✕ Écarter
          </button>
        </div>
      </footer>
    </article>
  );
}

function PostRow({ post, rank }: { post: SocialPost; rank: number }) {
  const meta = PLATFORM_META[post.platform];
  return (
    <a className="social-post-row" href={post.url} target="_blank" rel="noreferrer">
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <span className="post-platform-icon">{meta.emoji}</span>
      <span className="post-row-copy">
        <b>{post.title || post.text || "Publication sans légende"}</b>
        <small>{meta.label} · {getSocialFormatLabel(post)} · {post.published_at ? `il y a ${relativeAge(post.published_at)}` : "date publique absente"}</small>
      </span>
      <span className="row-metrics">
        {metrics(post).slice(0, 2).map((metric) => (
          <span key={metric.label}>{metric.icon} {formatNumber(metric.value)}</span>
        ))}
      </span>
      <span className={`mini-score score-${scoreTone(post.performance_score)}`}>{post.performance_score ?? "—"}</span>
    </a>
  );
}

function PostCard({ post, rank, compact }: { post: SocialPost; rank: number; compact: boolean }) {
  const meta = PLATFORM_META[post.platform];
  return (
    <a
      className={`social-post-card ${compact ? "compact" : ""}`}
      href={post.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Ouvrir « ${post.title || post.text || "publication"} » sur ${meta.label}`}
    >
      <div className="post-visual">
        {post.thumbnail_url ? <img src={post.thumbnail_url} alt="" loading="lazy" /> : <span>{meta.emoji}</span>}
        <span className={`platform-badge tone-${meta.tone}`}>{meta.emoji} {meta.label}</span>
        <span className="post-rank">#{rank}</span>
      </div>
      <div className="post-card-body">
        <div className="post-card-title">
          <div>
            <span className="section-kicker">{postLabel(post)} · {getSocialFormatLabel(post)}</span>
            <h3>{post.title || post.text || "Publication sans légende"}</h3>
          </div>
          <span className={`score-badge score-${scoreTone(post.performance_score)}`}>
            <b>{post.performance_score ?? "—"}</b><small>/100</small>
          </span>
        </div>
        <div className="metric-row">
          {metrics(post).map((metric) => (
            <span key={metric.label} title={metric.label}>{metric.icon} <b>{formatNumber(metric.value)}</b></span>
          ))}
        </div>
        {!compact ? (
          <div className="why-box">
            <span>Pourquoi ça ressort</span>
            <p>{post.score_explanation}</p>
          </div>
        ) : null}
        <footer>
          <span>{post.published_at ? `Publié il y a ${relativeAge(post.published_at)}` : "Date publique absente"} · relevé {formatDate(post.last_metric_at, true)}</span>
          <span className={`confidence confidence-${post.score_confidence}`}>{confidenceLabel(post.score_confidence)}</span>
        </footer>
      </div>
    </a>
  );
}
