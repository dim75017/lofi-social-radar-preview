"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come from live social sources with dynamic hosts. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import {
  getSocialVideoEmbed,
  getTikTokOEmbedUrl,
  parseTikTokThumbnailUrl,
} from "../lib/social-media";
import {
  rankPostsByPublicMetric,
} from "../lib/social-ranking";
import type { EditorialWhy } from "../lib/social-editorial-analysis";

type Platform = "youtube" | "instagram" | "tiktok" | "x";
type View = "overview" | "top" | "ideas" | "all" | "sources";
type IdeaDecision = "produce" | "rework" | "discard";

type MetricSnapshot = {
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  poll_votes: number | null;
  source: "live-scanner" | "public-history-collector" | string;
};

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
  raw_json?: string | null;
  performance_score: number | null;
  score_confidence: "high" | "medium" | "low" | "insufficient";
  score_explanation: string;
  analysis_label: string | null;
  source_kind: string;
  first_seen_at: string;
  last_seen_at: string;
  last_metric_at: string;
  published_at_precision?: "exact" | "approximate" | "unknown";
  metric_history?: MetricSnapshot[];
  editorial_analysis: EditorialWhy;
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
  { id: "all", emoji: "🔎", label: "Bibliothèque", group: "Données" },
  { id: "sources", emoji: "🔌", label: "Sources", group: "Données" },
];

const VIEW_COPY: Record<View, { title: string; subtitle: string }> = {
  overview: {
    title: "Command Center",
    subtitle: "Ce qui fonctionne vraiment sur les comptes Lofi Girl.",
  },
  top: {
    title: "Meilleurs posts",
    subtitle: "Les formats qui ont le mieux fonctionné, plateforme par plateforme.",
  },
  ideas: {
    title: "Idées à produire",
    subtitle: "Des concepts testables dérivés des signaux qui ressortent vraiment.",
  },
  all: {
    title: "Bibliothèque par catégorie",
    subtitle: "Une plateforme et un format à la fois, sans mélanger les catégories.",
  },
  sources: {
    title: "Sources officielles",
    subtitle: "Couverture, fraîcheur et limites visibles pour chaque réseau.",
  },
};

const IDEA_DECISIONS_STORAGE_KEY = "lofi-social-radar:idea-decisions:v1";
const POSTS_PAGE_SIZE = 48;
const PLATFORM_ORDER: Platform[] = ["youtube", "instagram", "tiktok", "x"];
const DEFAULT_FORMAT_FILTER: Record<Platform, SocialFormatFilter> = {
  youtube: "short",
  instagram: "reel",
  tiktok: "video",
  x: "static",
};

function categoryFilters(platform: Platform) {
  return getFormatFilters(platform).filter((filter) => filter.key !== "all");
}

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

function formatDetailedDate(value: string | null | undefined) {
  if (!value) return "Non disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
  const signal = post.editorial_analysis?.primarySignal;
  if (signal === "student_meme" || signal === "micro_progress") {
    return "Études & petites victoires";
  }
  if (signal === "collective_ritual" || signal === "care_ritual") {
    return "Care & communauté";
  }
  if (signal === "co_creation" || signal === "identity_choice" || signal === "absurd_poll") {
    return "Participation";
  }
  if (signal === "immersive_activation" || signal === "cultural_bridge") {
    return "Activation incarnée";
  }
  if (signal === "fourth_wall" || signal === "narrative_open_loop") {
    return "Personnage & micro-histoire";
  }
  if (signal === "commercial_copy") return "Information & activation";
  if (signal === "insufficient") return "Lecture à compléter";
  return "Relatable & humour";
}

function localInsights(posts: SocialPost[]): Insight[] {
  if (!posts.length) return [];
  const groups = new Map<string, SocialPost[]>();
  for (const post of posts) {
    const key = `${post.platform}:${post.format}`;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const top = rankPostsByPublicMetric(group).posts[0];
      return { group, top, analysis: top.editorial_analysis };
    })
    .filter(
      (item): item is { group: SocialPost[]; top: SocialPost; analysis: EditorialWhy } =>
        Boolean(item.analysis),
    )
    .sort((left, right) =>
      right.group.length !== left.group.length
        ? right.group.length - left.group.length
        : `${left.top.platform}:${left.top.format}`.localeCompare(
            `${right.top.platform}:${right.top.format}`,
          ),
    )
    .slice(0, 3)
    .map(({ top, analysis }) => ({
      emoji: PLATFORM_META[top.platform].emoji,
      title: analysis.headline,
      summary: analysis.mechanism,
      evidence: analysis.comparison,
    }));
}

function metricEmoji(metric: MetricKey, platform?: Platform) {
  if (metric === "views") return "👀";
  if (metric === "likes") return platform === "youtube" ? "👍" : "❤️";
  if (metric === "comments") return "💬";
  if (metric === "shares") return "↗️";
  if (metric === "saves") return "🔖";
  return "🗳️";
}

function metrics(post: SocialPost) {
  return [
    post.views !== null ? { icon: metricEmoji("views", post.platform), label: "vues", value: post.views } : null,
    post.likes !== null ? { icon: metricEmoji("likes", post.platform), label: "likes", value: post.likes } : null,
    post.comments !== null
      ? { icon: "💬", label: "commentaires", value: post.comments }
      : null,
    post.platform !== "tiktok" && post.shares !== null
      ? { icon: "↗", label: "partages", value: post.shares }
      : null,
    post.platform !== "tiktok" && post.saves !== null
      ? { icon: "🔖", label: "sauvegardes", value: post.saves }
      : null,
    post.poll_votes !== null
      ? { icon: "🗳️", label: "votes", value: post.poll_votes }
      : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: number }>;
}

type MetricKey = "views" | "likes" | "comments" | "shares" | "saves" | "poll_votes";

const METRIC_META: Record<MetricKey, { icon: string; label: string }> = {
  views: { icon: "👀", label: "vues" },
  likes: { icon: "❤️", label: "likes" },
  comments: { icon: "💬", label: "commentaires" },
  shares: { icon: "↗", label: "partages" },
  saves: { icon: "🔖", label: "sauvegardes" },
  poll_votes: { icon: "🗳️", label: "votes" },
};

function normalizedMetricHistory(post: SocialPost): MetricSnapshot[] {
  const fallback: MetricSnapshot = {
    captured_at: post.last_metric_at,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.saves,
    poll_votes: post.poll_votes,
    source: post.source_kind || "public-history-collector",
  };
  const source = post.metric_history?.length ? post.metric_history : [fallback];
  const byPoint = new Map<string, MetricSnapshot>();
  for (const point of source) {
    if (!point?.captured_at || Number.isNaN(new Date(point.captured_at).getTime())) continue;
    const cleaned = {
      captured_at: point.captured_at,
      views: numberOrNull(point.views),
      likes: numberOrNull(point.likes),
      comments: numberOrNull(point.comments),
      shares: numberOrNull(point.shares),
      saves: numberOrNull(point.saves),
      poll_votes: numberOrNull(point.poll_votes),
      source: point.source || "public-history-collector",
    } satisfies MetricSnapshot;
    byPoint.set(`${cleaned.source}:${cleaned.captured_at}`, cleaned);
  }
  return [...byPoint.values()].sort((left, right) =>
    left.captured_at.localeCompare(right.captured_at),
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function primaryTimelineMetric(post: SocialPost, history: MetricSnapshot[]): MetricKey | null {
  const preferred: MetricKey[] = ["views", "likes", "poll_votes", "comments", "shares", "saves"];
  return preferred.find((key) => post[key] !== null || history.some((point) => point[key] !== null)) ?? null;
}

function observationDelay(post: SocialPost, capturedAt: string | undefined) {
  if (!post.published_at || !capturedAt) {
    return "Impossible de relier ce relevé au lancement : la date publique exacte manque.";
  }
  if (post.published_at_precision && post.published_at_precision !== "exact") {
    return "La date de publication est approximative : ce relevé n’est pas présenté comme une mesure de lancement.";
  }
  const delayMs = new Date(capturedAt).getTime() - new Date(post.published_at).getTime();
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return "Ce relevé n’est pas présenté comme une mesure de lancement.";
  }
  const hours = Math.round(delayMs / 3_600_000);
  if (hours <= 24) {
    return `Premier relevé ${Math.max(0, hours)} h après publication : proche du lancement, mais pas le compteur exact à H0.`;
  }
  const days = Math.max(1, Math.round(hours / 24));
  return `Premier relevé ${days} j après publication : ce n’est pas une mesure de lancement.`;
}

function isNearLaunchObservation(post: SocialPost, capturedAt: string | undefined) {
  if (!post.published_at || !capturedAt) return false;
  if (post.published_at_precision && post.published_at_precision !== "exact") return false;
  const delayMs = new Date(capturedAt).getTime() - new Date(post.published_at).getTime();
  return Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 86_400_000;
}

function normalizedIdeaPost(post: SocialPost) {
  const raw = parsePostRaw(post.raw_json);
  if (post.poll_votes !== null) raw.pollVotes = post.poll_votes;
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
    raw,
  };
}

function parsePostRaw(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function pollChoices(post: SocialPost): string[] {
  const choices = parsePostRaw(post.raw_json).pollChoices;
  return Array.isArray(choices)
    ? choices.filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 0)
    : [];
}

function formatCardPublishedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [formatFilter, setFormatFilter] = useState<SocialFormatFilter>("short");
  const [topPlatform, setTopPlatform] = useState<Platform>("youtube");
  const [topFormatFilter, setTopFormatFilter] = useState<SocialFormatFilter>("short");
  const [topDuration, setTopDuration] = useState<SocialDurationFilter>("all");
  const [loading, setLoading] = useState(!initialWorkspace);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [postPagination, setPostPagination] = useState({ key: "", count: POSTS_PAGE_SIZE });
  const [ideaDecisions, setIdeaDecisions] = useState<Record<string, IdeaDecision>>({});
  const [ideaDecisionsReady, setIdeaDecisionsReady] = useState(false);
  const [activeDetailsPost, setActiveDetailsPost] = useState<SocialPost | null>(null);
  const [activeInlineVideoId, setActiveInlineVideoId] = useState<string | null>(null);
  const closeActiveDetails = useCallback(() => setActiveDetailsPost(null), []);
  const toggleInlineVideo = useCallback((post: SocialPost) => {
    const postId = `${post.platform}:${post.external_post_id}`;
    setActiveInlineVideoId((current) => current === postId ? null : postId);
  }, []);

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
          setTopFormatFilter(DEFAULT_FORMAT_FILTER[target]);
          setTopDuration("all");
          setView("top");
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
  const topPosts = useMemo(() => rankPostsByPublicMetric(posts).posts, [posts]);
  const topDurationReference = workspace?.generatedAt ?? "";
  const durationTopPosts = useMemo(
    () =>
      topPosts.filter((post) =>
        matchesSocialDuration(post, topDuration, topDurationReference),
      ),
    [topDuration, topDurationReference, topPosts],
  );
  const topPlatformPosts = useMemo(
    () => durationTopPosts.filter((post) => post.platform === topPlatform),
    [durationTopPosts, topPlatform],
  );
  const topCategoryPosts = useMemo(
    () =>
      topPlatformPosts.filter((post) =>
        matchesSocialFormatFilter(post, topFormatFilter),
      ),
    [topFormatFilter, topPlatformPosts],
  );
  const topCategoryRanking = useMemo(
    () => rankPostsByPublicMetric(topCategoryPosts),
    [topCategoryPosts],
  );
  const topFilteredPosts = topCategoryRanking.posts;
  const topLifetimeFilteredPosts = useMemo(() => {
    const platformPosts = topPosts.filter(
      (post) => post.platform === topPlatform,
    );
    return platformPosts.filter((post) =>
      matchesSocialFormatFilter(post, topFormatFilter),
    );
  }, [topFormatFilter, topPlatform, topPosts]);
  const topEmptyIsDuration =
    topDuration !== "all" && topLifetimeFilteredPosts.length > 0;
  const topUndatedCount = useMemo(
    () =>
      topDuration === "all"
        ? 0
        : topPosts.filter((post) => {
            if (post.platform !== topPlatform) return false;
            if (!matchesSocialFormatFilter(post, topFormatFilter)) {
              return false;
            }
            return !hasKnownSocialPublishedDate(post);
          }).length,
    [topDuration, topFormatFilter, topPlatform, topPosts],
  );
  const filteredCategoryPosts = useMemo(() => {
    return topPosts.filter(
      (post) =>
        post.platform === platform &&
        matchesSocialFormatFilter(post, formatFilter),
    );
  }, [formatFilter, platform, topPosts]);
  const filteredPosts = useMemo(
    () => rankPostsByPublicMetric(filteredCategoryPosts),
    [filteredCategoryPosts],
  ).posts;
  const activeTopFormat =
    categoryFilters(topPlatform).find((filter) => filter.key === topFormatFilter) ??
    categoryFilters(topPlatform)[0];
  const activeLibraryFormat =
    categoryFilters(platform).find((filter) => filter.key === formatFilter) ??
    categoryFilters(platform)[0];
  const insights = useMemo(() => {
    return localInsights(posts);
  }, [posts]);
  const ideaPlan = useMemo(
    () =>
      generateSocialIdeas(posts.map(normalizedIdeaPost), {
        now: workspace?.generatedAt,
        maxIdeas: 6,
        winnersPerPlatform: 4,
      }),
    [posts, workspace?.generatedAt],
  );
  const paginationKey = `${view}:${platform}:${formatFilter}`;
  const visiblePostCount =
    postPagination.key === paginationKey ? postPagination.count : POSTS_PAGE_SIZE;
  const visiblePosts = filteredPosts.slice(0, visiblePostCount);

  const chooseTopPlatform = (target: Platform) => {
    setView("top");
    setTopPlatform(target);
    setTopFormatFilter(DEFAULT_FORMAT_FILTER[target]);
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
                const isActive = view === item.id && !isTopItem;
                const isSectionActive = isTopSection;

                return (
                  <div
                    className={`nav-entry ${isTopItem ? "has-children" : ""}`}
                    key={item.id}
                  >
                    <button
                      className={isActive ? "active" : isSectionActive ? "section-active" : ""}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      aria-label={isTopItem ? "Meilleurs posts par plateforme et catégorie" : undefined}
                      onClick={() => {
                        if (item.id === "top") {
                          setView("top");
                          setMobileOpen(false);
                          return;
                        }

                        setView(item.id);
                        setMobileOpen(false);
                      }}
                    >
                      <span className="nav-emoji">{item.emoji}</span>
                      <span className="nav-text">{item.label}</span>
                      {isTopItem ? (
                        <span className="nav-count">{navCount(item.id)}</span>
                      ) : navCount(item.id) !== undefined ? (
                        <span className="nav-count">{navCount(item.id)}</span>
                      ) : null}
                    </button>

                    {isTopItem ? (
                      <div
                        className="nav-submenu"
                        id="top-platform-subnav"
                        role="group"
                        aria-label="Plateformes des meilleurs posts"
                      >
                        {PLATFORM_ORDER.map((key) => {
                          const meta = PLATFORM_META[key];
                          const isPlatformActive = view === "top" && topPlatform === key;
                          const count = posts.filter(
                            (post) => post.platform === key,
                          ).length;
                          return (
                            <button
                              className={isPlatformActive ? "active" : ""}
                              type="button"
                              aria-current={isPlatformActive ? "page" : undefined}
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
                        setTopFormatFilter(DEFAULT_FORMAT_FILTER[key]);
                        setTopDuration("all");
                        setView("top");
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
                    <span className="section-kicker">Posts à retenir</span>
                    <h3>Les publications les plus aimées</h3>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setTopPlatform("youtube");
                      setTopFormatFilter("short");
                      setTopDuration("all");
                      setView("top");
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
              className={`top-ranking-controls tone-${PLATFORM_META[topPlatform].tone}`}
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
              </div>

              <div className="top-format-control-row">
                <span className="section-kicker">
                  Catégories {PLATFORM_META[topPlatform].label}
                </span>
                <div
                  className="format-filter-tabs top-format-tabs"
                  role="group"
                  aria-label={`Catégories ${PLATFORM_META[topPlatform].label}`}
                >
                  {categoryFilters(topPlatform).map((filter) => {
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

              {topUndatedCount > 0 ? (
                <p className="top-undated-note">
                  ℹ️ {topUndatedCount} post{topUndatedCount > 1 ? "s" : ""} sans date
                  publique {topUndatedCount > 1 ? "restent" : "reste"} disponible{topUndatedCount > 1 ? "s" : ""}
                  uniquement dans All time.
                </p>
              ) : null}
            </section>

            <section
              className={`category-results tone-${PLATFORM_META[topPlatform].tone}`}
              aria-labelledby="active-category-title"
            >
              <header className="category-results-header">
                <div>
                  <span className="section-kicker">Catégorie active</span>
                  <h2 id="active-category-title">
                    {activeTopFormat?.emoji ?? "📂"} {PLATFORM_META[topPlatform].label} · {activeTopFormat?.label ?? topFormatFilter}
                  </h2>
                </div>
              </header>

              {topFilteredPosts.length ? (
                <div className="post-grid top-ranking-grid">
                  {topFilteredPosts.map((post, index) => (
                    <PostCard
                      post={post}
                      rank={index + 1}
                      compact={false}
                      isPlaying={activeInlineVideoId === `${post.platform}:${post.external_post_id}`}
                      onTogglePlayback={toggleInlineVideo}
                      onOpenDetails={setActiveDetailsPost}
                      key={post.id}
                    />
                  ))}
                </div>
              ) : (
                <div className={`format-empty-state top-ranking-empty tone-${PLATFORM_META[topPlatform].tone}`}>
                  <span>{topFormatFilter === "comment" ? "💭" : "📡"}</span>
                  <div>
                    <h3>
                      {topEmptyIsDuration
                        ? "Aucun contenu daté dans cette période"
                        : "Aucun contenu disponible pour cette catégorie"}
                    </h3>
                    <p>
                      {topEmptyIsDuration
                        ? "Essaie une durée plus large ou reviens à All time."
                        : formatEmptyCopy(topPlatform, topFormatFilter)}
                    </p>
                  </div>
                  <button className="button ghost compact" type="button" onClick={() => setView("sources")}>
                    Voir les limites →
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {workspace && view === "all" ? (
          <div className="view-stack">
            <div className="toolbar social-toolbar">
              <div className="filter-tabs" aria-label="Filtrer par plateforme">
                {PLATFORM_ORDER.map((key) => (
                  <button
                    className={platform === key ? "active" : ""}
                    type="button"
                    key={key}
                    onClick={() => {
                      setPlatform(key);
                      setFormatFilter(DEFAULT_FORMAT_FILTER[key]);
                    }}
                  >
                    {PLATFORM_META[key].emoji} {PLATFORM_META[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="format-filter-tabs all-format-filters"
              role="group"
              aria-label={`Catégories ${PLATFORM_META[platform].label}`}
            >
                {categoryFilters(platform).map((filter) => (
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

            <section
              className={`category-results tone-${PLATFORM_META[platform].tone}`}
              aria-labelledby="library-category-title"
            >
              <header className="category-results-header">
                <div>
                  <span className="section-kicker">Catégorie active</span>
                  <h2 id="library-category-title">
                    {activeLibraryFormat?.emoji ?? "📂"} {PLATFORM_META[platform].label} · {activeLibraryFormat?.label ?? formatFilter}
                  </h2>
                </div>
              </header>

              {filteredPosts.length ? (
                <>
                  <div className="post-list-grid">
                    {visiblePosts.map((post, index) => (
                      <PostCard
                        post={post}
                        rank={index + 1}
                        compact
                        isPlaying={activeInlineVideoId === `${post.platform}:${post.external_post_id}`}
                        onTogglePlayback={toggleInlineVideo}
                        onOpenDetails={setActiveDetailsPost}
                        key={post.id}
                      />
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
                </>
              ) : (
                <div className="empty-state">
                  <span>{formatFilter === "comment" ? "💭" : "🔎"}</span>
                  <h3>Aucun contenu pour cette catégorie</h3>
                  <p>{formatEmptyCopy(platform, formatFilter)}</p>
                  <button className="button ghost" type="button" onClick={() => setView("sources")}>
                    Voir les limites →
                  </button>
                </div>
              )}
            </section>
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

      <PostDetailsModal post={activeDetailsPost} onClose={closeActiveDetails} />
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
              <b>post source</b>
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
  const rowMetric =
    post.likes !== null
      ? { icon: "♥", label: `${formatNumber(post.likes)} likes` }
      : post.views !== null
        ? { icon: "▶", label: `${formatNumber(post.views)} vues` }
        : { icon: "—", label: "Métrique publique indisponible" };
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
      <span className="mini-score" title={rowMetric.label}>{rowMetric.icon}</span>
    </a>
  );
}

type TikTokThumbnailCacheEntry = { url: string; expiresAt: number };

const TIKTOK_THUMBNAIL_CACHE = new Map<string, TikTokThumbnailCacheEntry>();
const TIKTOK_THUMBNAIL_REQUESTS = new Map<string, Promise<string | null>>();
const TIKTOK_PREVIEW_TARGETS = new Map<Element, () => void>();
let sharedTikTokPreviewObserver: IntersectionObserver | null = null;

function getCachedTikTokThumbnail(externalId: string): string | null {
  const cached = TIKTOK_THUMBNAIL_CACHE.get(externalId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    TIKTOK_THUMBNAIL_CACHE.delete(externalId);
    return null;
  }
  return cached.url;
}

function requestTikTokThumbnail(
  externalId: string,
  oEmbedUrl: string,
): Promise<string | null> {
  const cached = getCachedTikTokThumbnail(externalId);
  if (cached) return Promise.resolve(cached);
  const pending = TIKTOK_THUMBNAIL_REQUESTS.get(externalId);
  if (pending) return pending;

  const request = fetch(oEmbedUrl, { mode: "cors" })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as { thumbnail_url?: unknown };
      const thumbnail = parseTikTokThumbnailUrl(payload.thumbnail_url);
      if (!thumbnail) return null;
      TIKTOK_THUMBNAIL_CACHE.set(externalId, thumbnail);
      return thumbnail.url;
    })
    .catch(() => null)
    .finally(() => TIKTOK_THUMBNAIL_REQUESTS.delete(externalId));
  TIKTOK_THUMBNAIL_REQUESTS.set(externalId, request);
  return request;
}

function observeTikTokPreview(target: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => undefined;
  }
  if (!sharedTikTokPreviewObserver) {
    sharedTikTokPreviewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = TIKTOK_PREVIEW_TARGETS.get(entry.target);
          TIKTOK_PREVIEW_TARGETS.delete(entry.target);
          sharedTikTokPreviewObserver?.unobserve(entry.target);
          callback?.();
        }
      },
      { rootMargin: "420px" },
    );
  }
  TIKTOK_PREVIEW_TARGETS.set(target, onVisible);
  sharedTikTokPreviewObserver.observe(target);
  return () => {
    TIKTOK_PREVIEW_TARGETS.delete(target);
    sharedTikTokPreviewObserver?.unobserve(target);
  };
}

function PostCard({
  post,
  rank,
  compact,
  isPlaying,
  onTogglePlayback,
  onOpenDetails,
}: {
  post: SocialPost;
  rank: number;
  compact: boolean;
  isPlaying: boolean;
  onTogglePlayback: (post: SocialPost) => void;
  onOpenDetails: (post: SocialPost) => void;
}) {
  const isCommunityImage = post.platform === "youtube" && post.format === "community_image";
  const hasMediaPreview = Boolean(getSocialVideoEmbed(post) || post.thumbnail_url || isCommunityImage);
  const postCopy = post.text || post.title || "Publication sans légende";
  const choices = post.format === "community_poll" ? pollChoices(post) : [];
  const publishedDate = formatCardPublishedDate(post.published_at);
  const textLinkRef = useRef<HTMLAnchorElement>(null);
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  const [isTextOverflowing, setIsTextOverflowing] = useState(false);
  const footerMetrics = [
    post.views !== null ? { icon: metricEmoji("views", post.platform), label: "vues", value: post.views } : null,
    post.likes !== null ? { icon: metricEmoji("likes", post.platform), label: "likes", value: post.likes } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: number }>;

  useEffect(() => {
    if (hasMediaPreview || isTextExpanded) return;
    const element = textLinkRef.current;
    if (!element) return;
    const updateOverflow = () => setIsTextOverflowing(element.scrollHeight > element.clientHeight + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMediaPreview, isTextExpanded, postCopy]);

  return (
    <article
      className={`social-post-card ${compact ? "compact" : ""} ${hasMediaPreview ? "has-media" : "text-only"}`}
    >
      {hasMediaPreview ? (
        <PostMediaPreview
          post={post}
          rank={rank}
          isPlaying={isPlaying}
          onTogglePlayback={onTogglePlayback}
          onOpenDetails={onOpenDetails}
        />
      ) : null}
      <div className="post-card-body">
        {!hasMediaPreview ? (
          <div className="post-card-meta-row">
            <span className="inline-post-rank">#{rank}</span>
          </div>
        ) : null}
        <div className="post-card-title">
          <div>
            {hasMediaPreview ? (
              <h3>
                <a href={post.url} target="_blank" rel="noreferrer">
                  {post.title || post.text || "Publication sans légende"}
                </a>
              </h3>
            ) : (
              <div className={`post-text-content ${isTextExpanded ? "is-expanded" : ""}`}>
                <a ref={textLinkRef} href={post.url} target="_blank" rel="noreferrer">
                  {postCopy}
                </a>
                {isTextOverflowing ? (
                  <button
                    className="post-text-expand"
                    type="button"
                    aria-expanded={isTextExpanded}
                    onClick={() => setIsTextExpanded((value) => !value)}
                  >
                    {isTextExpanded ? "Réduire" : "…"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
        {choices.length ? (
          <ul className="poll-choice-list" aria-label="Options du sondage">
            {choices.map((choice) => <li key={choice}>{choice}</li>)}
          </ul>
        ) : null}
        <footer>
          {publishedDate ? (
            <time className="post-published-date" dateTime={post.published_at ?? undefined}>
              {publishedDate}
            </time>
          ) : <span />}
          <span className="post-card-footer-metrics" aria-label="Performances visibles">
            {footerMetrics.map((metric) => (
              <span key={metric.label} title={metric.label}>
                {metric.icon} <b>{formatNumber(metric.value)}</b>
              </span>
            ))}
          </span>
          <span className="post-card-actions">
            <button type="button" onClick={() => onOpenDetails(post)}>
              Plus d’informations
            </button>
          </span>
        </footer>
      </div>
    </article>
  );
}

function PostMediaPreview({
  post,
  rank,
  isPlaying,
  onTogglePlayback,
  onOpenDetails,
}: {
  post: SocialPost;
  rank: number;
  isPlaying: boolean;
  onTogglePlayback: (post: SocialPost) => void;
  onOpenDetails: (post: SocialPost) => void;
}) {
  const meta = PLATFORM_META[post.platform];
  const video = getSocialVideoEmbed(post);
  const previewRef = useRef<HTMLDivElement>(null);
  const videoPlatform = video?.platform;
  const videoExternalId = video?.externalId;
  const posterUrl = video?.posterUrl ?? post.thumbnail_url;
  const oEmbedUrl = getTikTokOEmbedUrl(post);
  const cachedTikTokThumbnail =
    videoPlatform === "tiktok" && videoExternalId
      ? getCachedTikTokThumbnail(videoExternalId)
      : null;
  const initialThumbnail = posterUrl ?? cachedTikTokThumbnail;
  const [thumbnail, setThumbnail] = useState<string | null>(initialThumbnail);
  const [thumbnailSource, setThumbnailSource] = useState<
    "poster" | "cache" | "oembed" | "none"
  >(posterUrl ? "poster" : cachedTikTokThumbnail ? "cache" : "none");
  const [shouldLoadTikTokThumbnail, setShouldLoadTikTokThumbnail] = useState(
    videoPlatform === "tiktok" && !initialThumbnail,
  );

  useEffect(() => {
    if (
      videoPlatform !== "tiktok" ||
      !videoExternalId ||
      !oEmbedUrl ||
      !shouldLoadTikTokThumbnail
    ) {
      return;
    }
    let cancelled = false;
    const loadThumbnail = () => {
      void requestTikTokThumbnail(videoExternalId, oEmbedUrl).then((url) => {
        if (cancelled) return;
        setShouldLoadTikTokThumbnail(false);
        if (!url) return;
        setThumbnail(url);
        setThumbnailSource("oembed");
      });
    };

    const target = previewRef.current;
    let stopObserving: () => void = () => undefined;
    if (target) stopObserving = observeTikTokPreview(target, loadThumbnail);
    else loadThumbnail();

    return () => {
      cancelled = true;
      stopObserving();
    };
  }, [oEmbedUrl, shouldLoadTikTokThumbnail, videoExternalId, videoPlatform]);

  return (
    <div
      className={`post-visual platform-${post.platform} ${video ? "is-playable" : "is-image"} ${video && isPlaying ? "is-playing" : ""}`}
      ref={previewRef}
    >
      {video && isPlaying ? (
        <>
          <div className="inline-video-frame">
            <iframe
              src={video.playerUrl}
              title={`Lecteur ${meta.label} : ${post.title || post.text || "publication"}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
          <button
            className="inline-player-close"
            type="button"
            onClick={() => onTogglePlayback(post)}
            aria-label="Fermer le lecteur intégré"
          >
            ✕
          </button>
        </>
      ) : (
        <button
          className="post-visual-trigger"
          type="button"
          onClick={() => video ? onTogglePlayback(post) : onOpenDetails(post)}
          disabled={!video && !thumbnail}
          aria-label={
            video
              ? `Lire « ${post.title || post.text || "cette vidéo"} » directement dans le radar`
              : `Voir les informations de « ${post.title || post.text || "cette publication"} »`
          }
        >
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              onError={() => {
                if (videoPlatform === "tiktok" && videoExternalId) {
                  TIKTOK_THUMBNAIL_CACHE.delete(videoExternalId);
                  if (thumbnailSource !== "oembed") {
                    setShouldLoadTikTokThumbnail(true);
                  }
                }
                setThumbnailSource("none");
                setThumbnail(null);
              }}
            />
          ) : (
            <span className="post-preview-placeholder" aria-hidden="true">
              <b>{meta.emoji}</b>
              {video ? <small>Aperçu {meta.label}</small> : null}
            </span>
          )}
          {video ? <span className="media-play-mark" aria-hidden="true">▶</span> : null}
        </button>
      )}
      {!isPlaying ? <span className="post-rank">#{rank}</span> : null}
    </div>
  );
}

function PostDetailsModal({
  post,
  onClose,
}: {
  post: SocialPost | null;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const isOpen = Boolean(post);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!post) return null;
  const meta = PLATFORM_META[post.platform];
  const title = post.title || post.text || `Publication ${meta.label}`;
  const thumbnail = getSocialVideoEmbed(post)?.posterUrl ?? post.thumbnail_url;
  const history = normalizedMetricHistory(post);
  const primaryMetric = primaryTimelineMetric(post, history);
  const timelinePoints = primaryMetric
    ? history.filter((point) => point[primaryMetric] !== null)
    : [];
  const firstPoint = timelinePoints[0];
  const lastPoint = timelinePoints.at(-1);
  const firstValue = primaryMetric && firstPoint ? firstPoint[primaryMetric] : null;
  const lastValue = primaryMetric && lastPoint ? lastPoint[primaryMetric] : null;
  const totalDelta = firstValue !== null && lastValue !== null ? lastValue - firstValue : null;
  const nearLaunch = isNearLaunchObservation(post, firstPoint?.captured_at);
  const editorialAnalysis = post.editorial_analysis;
  const detailTheme = postLabel(post);
  const editorialAnalysisId = `details-editorial-${post.platform}-${post.external_post_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const precisionLabel = post.published_at_precision === "exact"
    ? "Date exacte"
    : post.published_at_precision === "approximate"
      ? "Date approximative"
      : "Précision inconnue";

  return (
    <div
      className="post-details-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`post-details-modal tone-${meta.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-details-title"
        ref={modalRef}
      >
        <header>
          <div>
            <span>{meta.emoji} Fiche détaillée · {getSocialFormatLabel(post)}</span>
            <h2 id="post-details-title">{title}</h2>
            <small className="details-theme-label">{detailTheme}</small>
          </div>
          <button
            className="post-details-close"
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
            aria-label="Fermer la fiche détaillée"
          >
            ✕
          </button>
        </header>

        <div className={`post-details-summary ${thumbnail ? "has-thumbnail" : ""}`}>
          {thumbnail ? (
            <img src={thumbnail} alt="" />
          ) : null}
          <div>
            <span className="section-kicker">Publication</span>
            <p>{post.text || post.title || "Aucun texte public associé."}</p>
            {post.format === "community_poll" && pollChoices(post).length ? (
              <ul className="poll-choice-list details-poll-choice-list" aria-label="Options du sondage">
                {pollChoices(post).map((choice) => <li key={choice}>{choice}</li>)}
              </ul>
            ) : null}
            <div className="metric-row details-current-metrics">
              {metrics(post).map((metric) => (
                <span key={metric.label} title={metric.label}>
                  {metric.icon} <b>{formatNumber(metric.value)}</b> {metric.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="post-observation-grid">
          <div>
            <span>Publié</span>
            <b>{formatDetailedDate(post.published_at)}</b>
            <small>{post.published_at ? precisionLabel : "Date publique absente"}</small>
          </div>
          <div>
            <span>Premier relevé</span>
            <b>{formatDetailedDate(firstPoint?.captured_at ?? post.first_seen_at)}</b>
            <small>Première valeur réellement enregistrée par le radar</small>
          </div>
          <div className="launch-observation-card">
            <span>Mesure au lancement</span>
            <b>
              {nearLaunch && primaryMetric && firstValue !== null
                ? `${formatNumber(firstValue)} ${METRIC_META[primaryMetric].label} au 1er relevé`
                : "Non mesurée"}
            </b>
            <small>{observationDelay(post, firstPoint?.captured_at)}</small>
          </div>
          <div>
            <span>Dernier relevé</span>
            <b>{formatDetailedDate(lastPoint?.captured_at ?? post.last_metric_at)}</b>
            <small>{history.length} point{history.length > 1 ? "s" : ""} de mesure conservé{history.length > 1 ? "s" : ""}</small>
          </div>
        </div>

        <section className="metric-evolution" aria-labelledby="metric-evolution-title">
          <div className="details-section-heading">
            <div>
              <span className="section-kicker">Évolution mesurée</span>
              <h3 id="metric-evolution-title">
                {primaryMetric ? `${METRIC_META[primaryMetric].icon} ${METRIC_META[primaryMetric].label}` : "Aucune métrique publique"}
              </h3>
            </div>
            {totalDelta !== null && timelinePoints.length > 1 ? (
              <span className={`metric-delta ${totalDelta >= 0 ? "positive" : "negative"}`}>
                {totalDelta >= 0 ? "+" : ""}{formatNumber(totalDelta)} depuis le premier relevé
              </span>
            ) : null}
          </div>
          {timelinePoints.length > 1 && primaryMetric ? (
            <div className="metric-timeline">
              {timelinePoints.slice(-8).map((point, index, points) => {
                const value = point[primaryMetric];
                const previousValue = index > 0 ? points[index - 1][primaryMetric] : null;
                const delta = value !== null && previousValue !== null ? value - previousValue : null;
                return (
                  <div key={`${point.source}:${point.captured_at}`}>
                    <span>{formatDetailedDate(point.captured_at)}</span>
                    <b>{formatNumber(value)}</b>
                    <small>
                      {delta === null || index === 0
                        ? "Premier point affiché"
                        : `${delta >= 0 ? "+" : ""}${formatNumber(delta)}`}
                    </small>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="metric-history-empty">
              <span>📍</span>
              <div>
                <b>Un seul relevé disponible pour l’instant</b>
                <p>La progression s’affichera automatiquement dès le prochain scan. Le radar ne reconstruit pas une courbe passée qu’il n’a pas observée.</p>
              </div>
            </div>
          )}
        </section>

        {editorialAnalysis ? (
          <section
            className={`editorial-why details-editorial-why status-${editorialAnalysis.status}`}
            aria-labelledby={editorialAnalysisId}
          >
            <div className="editorial-why-heading">
              <span id={editorialAnalysisId}>🧠 Pourquoi ça ressort</span>
              <small>
                {editorialAnalysis.status === "no-differentiator"
                  ? "Différence non isolée"
                  : editorialAnalysis.confidence === "medium"
                    ? "Comparaison étayée"
                    : "Hypothèse prudente"}
              </small>
            </div>
            <h4>{editorialAnalysis.headline}</h4>
            <p>{editorialAnalysis.mechanism}</p>
            <div className="editorial-why-comparison">
              <b>Ce qui le différencie</b>
              <span>{editorialAnalysis.comparison}</span>
            </div>
            <div className="editorial-why-lesson">
              <b>À reproduire</b>
              <span>{editorialAnalysis.transferableLesson}</span>
            </div>
            {editorialAnalysis.limitations[0] ? (
              <small className="editorial-why-limit">
                Périmètre : {editorialAnalysis.limitations[0]}
              </small>
            ) : null}
          </section>
        ) : null}

        <footer>
          <span>Données publiques réellement observées · aucune trajectoire inventée</span>
          <a href={post.url} target="_blank" rel="noreferrer">
            Ouvrir sur {meta.label} ↗
          </a>
        </footer>
      </section>
    </div>
  );
}
