"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come from live social sources with dynamic hosts. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  generateSocialIdeas,
  type SocialIdea,
} from "../lib/social-ideas";
import {
  applyPreferenceLearning,
  EMPTY_EDITORIAL_WORKFLOW,
  feedbackForIdea,
  normalizeWorkflowState,
  scheduleAcceptedIdea,
  updateScheduledDate,
  type EditorialWorkflowState,
  type IdeaDecision,
  type LearnedIdea,
  type ScheduledIdea,
} from "../lib/editorial-workflow";
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
import {
  buildEditorialAnalysisMapForTargets,
  editorialPostKey,
  type EditorialWhy,
} from "../lib/social-editorial-analysis";

type Platform = "youtube" | "instagram" | "tiktok" | "x";
type View = "overview" | "top" | "ideas" | "planning" | "all" | "sources";
type IdeaPlatformFilter = "all" | Platform;
type IdeaStatusFilter = "all" | "pending" | IdeaDecision;
type PostSort = "popular" | "recent";

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
  editorial_analysis?: EditorialWhy;
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
  group: "Pilotage";
}> = [
  { id: "overview", emoji: "📊", label: "Command Center", group: "Pilotage" },
  { id: "top", emoji: "🏆", label: "Meilleurs posts", group: "Pilotage" },
  { id: "ideas", emoji: "💡", label: "Recommandations", group: "Pilotage" },
  { id: "planning", emoji: "🗓️", label: "Roadmap", group: "Pilotage" },
];

const EDITORIAL_WORKFLOW_STORAGE_KEY = "lofi-social-radar:editorial-workflow:v2";
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
      return "Aucun commentaire YouTube correspondant n’est disponible pour cette période.";
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

function postLabel(post: SocialPost, editorialAnalysis?: EditorialWhy | null) {
  if (post.analysis_label) return post.analysis_label;
  const signal = (editorialAnalysis ?? post.editorial_analysis)?.primarySignal;
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
  if (metric === "views") return "📊";
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

function sortPosts(posts: readonly SocialPost[], sort: PostSort) {
  if (sort === "popular") return rankPostsByPublicMetric(posts).posts;
  return [...posts].sort((left, right) => {
    const leftDate = left.published_at ? new Date(left.published_at).getTime() : Number.NaN;
    const rightDate = right.published_at ? new Date(right.published_at).getTime() : Number.NaN;
    const leftKnown = Number.isFinite(leftDate);
    const rightKnown = Number.isFinite(rightDate);
    if (leftKnown && rightKnown && rightDate !== leftDate) return rightDate - leftDate;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    return rankPostsByPublicMetric([left, right]).posts[0] === left ? -1 : 1;
  });
}

type MetricKey = "views" | "likes" | "comments" | "shares" | "saves" | "poll_votes";

const METRIC_META: Record<MetricKey, { icon: string; label: string }> = {
  views: { icon: "📊", label: "vues" },
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
  publicCounts,
  publicFormatCounts,
  pendingPlatforms = [],
  historyError = "",
}: {
  initialWorkspace?: WorkspacePayload | null;
  previewMode?: boolean;
  publicCounts?: Partial<Record<Platform, number>>;
  publicFormatCounts?: Partial<Record<Platform, Record<string, number>>>;
  pendingPlatforms?: Platform[];
  historyError?: string;
}) {
  const [loadedWorkspace, setLoadedWorkspace] = useState<WorkspacePayload | null>(initialWorkspace);
  const workspace = previewMode ? initialWorkspace : loadedWorkspace;
  const [view, setView] = useState<View>("overview");
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [formatFilter, setFormatFilter] = useState<SocialFormatFilter>("short");
  const [topPlatform, setTopPlatform] = useState<Platform>("youtube");
  const [topFormatFilter, setTopFormatFilter] = useState<SocialFormatFilter>("short");
  const [topDuration, setTopDuration] = useState<SocialDurationFilter>("all");
  const [topSort, setTopSort] = useState<PostSort>("popular");
  const [librarySort, setLibrarySort] = useState<PostSort>("popular");
  const [loading, setLoading] = useState(!initialWorkspace);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [postPagination, setPostPagination] = useState({ key: "", count: POSTS_PAGE_SIZE });
  const [editorialWorkflow, setEditorialWorkflow] = useState<EditorialWorkflowState>(EMPTY_EDITORIAL_WORKFLOW);
  const [editorialWorkflowReady, setEditorialWorkflowReady] = useState(false);
  const [editorialWorkflowSyncing, setEditorialWorkflowSyncing] = useState(false);
  const editorialWorkflowMutationRef = useRef(false);
  const [ideaPlatformFilter, setIdeaPlatformFilter] = useState<IdeaPlatformFilter>("all");
  const [ideaStatusFilter, setIdeaStatusFilter] = useState<IdeaStatusFilter>("pending");
  const [activeRecommendation, setActiveRecommendation] = useState<LearnedIdea | null>(null);
  const [activeDetailsPost, setActiveDetailsPost] = useState<SocialPost | null>(null);
  const [activeInlineVideoId, setActiveInlineVideoId] = useState<string | null>(null);
  const closeActiveDetails = useCallback(() => setActiveDetailsPost(null), []);
  const closeActiveRecommendation = useCallback(() => setActiveRecommendation(null), []);
  const toggleInlineVideo = useCallback((post: SocialPost) => {
    const postId = `${post.platform}:${post.external_post_id}`;
    setActiveInlineVideoId((current) => current === postId ? null : postId);
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const payload = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Le radar ne répond pas.");
      setLoadedWorkspace(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [previewMode]);

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
    let cancelled = false;
    const loadEditorialWorkflow = async () => {
      if (previewMode) {
        let next = EMPTY_EDITORIAL_WORKFLOW;
        try {
          const saved = window.localStorage.getItem(EDITORIAL_WORKFLOW_STORAGE_KEY);
          if (saved) next = normalizeWorkflowState(JSON.parse(saved));
        } catch {
          // The public preview remains usable when browser storage is blocked.
        }
        if (!cancelled) {
          setEditorialWorkflow(next);
          setEditorialWorkflowReady(true);
        }
        return;
      }
      try {
        const response = await fetch("/api/editorial-workflow", { cache: "no-store" });
        const payload = await response.json() as EditorialWorkflowState & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Le workflow éditorial ne répond pas.");
        if (!cancelled) setEditorialWorkflow(normalizeWorkflowState(payload));
      } catch (workflowError) {
        if (!cancelled) {
          setError(
            workflowError instanceof Error
              ? workflowError.message
              : "Le workflow éditorial ne répond pas.",
          );
        }
      } finally {
        if (!cancelled) setEditorialWorkflowReady(true);
      }
    };
    void loadEditorialWorkflow();
    return () => {
      cancelled = true;
    };
  }, [previewMode]);

  useEffect(() => {
    if (!previewMode || !editorialWorkflowReady) return;
    try {
      window.localStorage.setItem(
        EDITORIAL_WORKFLOW_STORAGE_KEY,
        JSON.stringify(editorialWorkflow),
      );
    } catch {
      // Keep the in-memory state when the browser refuses local storage.
    }
  }, [editorialWorkflow, editorialWorkflowReady, previewMode]);

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
          setToast(`Recommandations recalculées sur ${workspace?.posts.length ?? 0} contenus publics`);
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
  const normalizedPosts = useMemo(
    () => posts.map(normalizedIdeaPost),
    [posts],
  );
  const resolvedPlatformCounts = useMemo(() => {
    const counts = { youtube: 0, instagram: 0, tiktok: 0, x: 0 } satisfies Record<Platform, number>;
    for (const post of posts) counts[post.platform] += 1;
    for (const key of PLATFORM_ORDER) {
      const publishedCount = publicCounts?.[key];
      if (publishedCount !== undefined) counts[key] = publishedCount;
    }
    return counts;
  }, [posts, publicCounts]);
  const totalPostCount = PLATFORM_ORDER.reduce(
    (total, key) => total + resolvedPlatformCounts[key],
    0,
  );
  const historyLoading = pendingPlatforms.length > 0;
  const loadedPlatformCount = PLATFORM_ORDER.length - pendingPlatforms.length;
  const topPlatformPending = pendingPlatforms.includes(topPlatform);
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
  const topFilteredPosts = useMemo(
    () => sortPosts(topCategoryPosts, topSort),
    [topCategoryPosts, topSort],
  );
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
    () => sortPosts(filteredCategoryPosts, librarySort),
    [filteredCategoryPosts, librarySort],
  );
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
      generateSocialIdeas(historyLoading ? [] : normalizedPosts, {
        now: workspace?.generatedAt,
        maxIdeas: 50,
        winnersPerPlatform: 8,
      }),
    [historyLoading, normalizedPosts, workspace?.generatedAt],
  );
  const learnedIdeas = useMemo(
    () => applyPreferenceLearning(ideaPlan.ideas, editorialWorkflow.feedback),
    [editorialWorkflow.feedback, ideaPlan.ideas],
  );
  const filteredIdeas = useMemo(
    () => learnedIdeas.filter((idea) => {
      if (ideaPlatformFilter !== "all" && idea.primaryPlatform !== ideaPlatformFilter) {
        return false;
      }
      const decision = editorialWorkflow.feedback[idea.id]?.decision;
      if (ideaStatusFilter === "pending") return !decision || decision === "rework";
      if (ideaStatusFilter !== "all") return decision === ideaStatusFilter;
      return true;
    }),
    [editorialWorkflow.feedback, ideaPlatformFilter, ideaStatusFilter, learnedIdeas],
  );
  const ideaDecisionCounts = useMemo(() => {
    const counts = { pending: 0, produce: 0, rework: 0, discard: 0 };
    for (const idea of learnedIdeas) {
      const decision = editorialWorkflow.feedback[idea.id]?.decision;
      if (decision) counts[decision] += 1;
      else counts.pending += 1;
    }
    return counts;
  }, [editorialWorkflow.feedback, learnedIdeas]);
  const ideaPlatformCounts = useMemo(() => {
    const counts = { youtube: 0, instagram: 0, tiktok: 0, x: 0 } satisfies Record<Platform, number>;
    for (const idea of learnedIdeas) counts[idea.primaryPlatform] += 1;
    return counts;
  }, [learnedIdeas]);
  const visibleIdeas = filteredIdeas;
  const activeDetailsAnalysis = useMemo(() => {
    if (!activeDetailsPost) return null;
    if (activeDetailsPost.editorial_analysis) {
      return activeDetailsPost.editorial_analysis;
    }
    const key = editorialPostKey({
      platform: activeDetailsPost.platform,
      externalId: activeDetailsPost.external_post_id,
    });
    return buildEditorialAnalysisMapForTargets(normalizedPosts, [key]).get(key) ?? null;
  }, [activeDetailsPost, normalizedPosts]);
  const paginationKey = `${view}:${platform}:${formatFilter}:${librarySort}`;
  const visiblePostCount =
    postPagination.key === paginationKey ? postPagination.count : POSTS_PAGE_SIZE;
  const visiblePosts = filteredPosts.slice(0, visiblePostCount);

  const chooseTopPlatform = (target: Platform) => {
    setView("top");
    setTopPlatform(target);
    setTopFormatFilter(DEFAULT_FORMAT_FILTER[target]);
    setMobileOpen(false);
  };

  const setIdeaDecision = useCallback(async (idea: SocialIdea, decision: IdeaDecision) => {
    if (!previewMode && editorialWorkflowMutationRef.current) {
      setToast("Une décision est déjà en cours d’enregistrement.");
      return;
    }
    if (!previewMode) {
      editorialWorkflowMutationRef.current = true;
      setEditorialWorkflowSyncing(true);
    }
    const previous = editorialWorkflow;
    const now = new Date().toISOString();
    const feedback = feedbackForIdea(idea, decision, now);
    const schedule = decision === "produce"
      ? editorialWorkflow.schedule.some((item) => item.ideaId === idea.id)
        ? editorialWorkflow.schedule
        : [...editorialWorkflow.schedule, scheduleAcceptedIdea(idea, editorialWorkflow.schedule, now)]
      : editorialWorkflow.schedule.filter((item) => item.ideaId !== idea.id);
    const optimistic = {
      feedback: { ...editorialWorkflow.feedback, [idea.id]: feedback },
      schedule,
    };
    setEditorialWorkflow(optimistic);
    const scheduled = schedule.find((item) => item.ideaId === idea.id);
    setToast(
      decision === "produce" && scheduled
        ? `✅ Acceptée · planifiée automatiquement le ${formatCardPublishedDate(`${scheduled.scheduledFor}T12:00:00.000Z`)}`
        : decision === "rework"
          ? "🛠️ Marquée à retravailler · préférence mémorisée"
          : "✕ Écartée · préférence mémorisée",
    );
    if (previewMode) return;

    try {
      const response = await fetch("/api/editorial-workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decide", idea, decision }),
      });
      const payload = await response.json() as EditorialWorkflowState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Décision non enregistrée.");
      setEditorialWorkflow(normalizeWorkflowState(payload));
    } catch (decisionError) {
      setEditorialWorkflow(previous);
      setToast(
        decisionError instanceof Error ? decisionError.message : "Décision non enregistrée.",
      );
    } finally {
      editorialWorkflowMutationRef.current = false;
      setEditorialWorkflowSyncing(false);
    }
  }, [editorialWorkflow, previewMode]);

  const rescheduleIdea = useCallback(async (ideaId: string, scheduledFor: string) => {
    if (!previewMode && editorialWorkflowMutationRef.current) {
      setToast("Une modification du planning est déjà en cours.");
      return;
    }
    const previous = editorialWorkflow;
    let optimisticSchedule: ScheduledIdea[];
    try {
      optimisticSchedule = updateScheduledDate(editorialWorkflow.schedule, ideaId, scheduledFor);
    } catch (scheduleError) {
      setToast(scheduleError instanceof Error ? scheduleError.message : "Date invalide.");
      return;
    }
    if (!previewMode) {
      editorialWorkflowMutationRef.current = true;
      setEditorialWorkflowSyncing(true);
    }
    setEditorialWorkflow({ ...editorialWorkflow, schedule: optimisticSchedule });
    setToast(`🗓️ Déplacée au ${formatCardPublishedDate(`${scheduledFor}T12:00:00.000Z`)}`);
    if (previewMode) return;

    try {
      const response = await fetch("/api/editorial-workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reschedule", ideaId, scheduledFor }),
      });
      const payload = await response.json() as EditorialWorkflowState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Planning non enregistré.");
      setEditorialWorkflow(normalizeWorkflowState(payload));
    } catch (scheduleError) {
      setEditorialWorkflow(previous);
      setToast(scheduleError instanceof Error ? scheduleError.message : "Planning non enregistré.");
    } finally {
      editorialWorkflowMutationRef.current = false;
      setEditorialWorkflowSyncing(false);
    }
  }, [editorialWorkflow, previewMode]);
  const activeSources = PLATFORM_ORDER.filter(
    (key) => resolvedPlatformCounts[key] > 0,
  ).length;
  const lastSuccess = accounts
    .map((account) => account.last_success_at)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;

  const navCount = (id: View) => {
    if (id === "top") return totalPostCount;
    if (id === "ideas") return ideaPlan.ideas.length;
    if (id === "planning") return editorialWorkflow.schedule.length;
    if (id === "all") return totalPostCount;
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
          {(["Pilotage"] as const).map((group) => (
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
                          const count = resolvedPlatformCounts[key];
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

        {historyError ? (
          <div className="error-banner" role="alert">
            <span>⚠️</span>
            <div>
              <b>Les fiches détaillées ne sont pas disponibles</b>
              <p>{historyError}</p>
            </div>
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
                <span className="freshness">
                  {totalPostCount} contenus · relevé {formatDate(lastSuccess ?? null, true)}
                </span>
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
                          <b>{resolvedPlatformCounts[key]}</b>
                        <small>posts</small>
                      </span>
                      <span className={`source-state ${account?.status ?? "idle"}`}>
                        {account?.status === "error" ? "Erreur" : account?.status === "limited" ? "Limité" : "Actif"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Analyse éditoriale</span>
                  <h3>Ce qui mérite l’attention de l’équipe</h3>
                </div>
                <span className="freshness">
                  {historyLoading
                    ? `${loadedPlatformCount}/4 réseaux prêts`
                    : `Calculé sur ${posts.length} posts réels`}
                </span>
              </div>
              {historyLoading ? (
                <HistoryLoadingState
                  loadedPlatformCount={loadedPlatformCount}
                  label="Analyse des posts en arrière-plan"
                />
              ) : (
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
              )}
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
                {historyLoading ? (
                  <HistoryLoadingState
                    loadedPlatformCount={loadedPlatformCount}
                    label="Préparation du classement complet"
                    compact
                  />
                ) : (
                  <div className="top-post-list">
                    {topPosts.slice(0, 5).map((post, index) => (
                      <PostRow post={post} rank={index + 1} key={post.id} />
                    ))}
                  </div>
                )}
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
          <div className="recommendations-view">
            <header className="recommendations-heading">
              <h2>Recommandations</h2>
            </header>

            <div className="reco-controlbar">
              <div className="reco-status-tabs" role="tablist" aria-label="Statut des recommandations">
                <button
                  className={ideaStatusFilter === "pending" || ideaStatusFilter === "rework" ? "active pending" : "pending"}
                  type="button"
                  role="tab"
                  aria-selected={ideaStatusFilter === "pending" || ideaStatusFilter === "rework"}
                  onClick={() => setIdeaStatusFilter("pending")}
                >
                  <span>🟡 À valider</span><b>{ideaDecisionCounts.pending + ideaDecisionCounts.rework}</b>
                </button>
                <button
                  className={ideaStatusFilter === "produce" ? "active validated" : "validated"}
                  type="button"
                  role="tab"
                  aria-selected={ideaStatusFilter === "produce"}
                  onClick={() => setIdeaStatusFilter("produce")}
                >
                  <span>✓ Validées</span><b>{ideaDecisionCounts.produce}</b>
                </button>
                <button
                  className={ideaStatusFilter === "discard" ? "active refused" : "refused"}
                  type="button"
                  role="tab"
                  aria-selected={ideaStatusFilter === "discard"}
                  onClick={() => setIdeaStatusFilter("discard")}
                >
                  <span>✕ Refusées</span><b>{ideaDecisionCounts.discard}</b>
                </button>
              </div>
              <button
                className="reco-refresh-button"
                type="button"
                disabled={scanning}
                onClick={() => {
                  setIdeaPlatformFilter("all");
                  setIdeaStatusFilter("pending");
                  void runScan();
                }}
              >
                ↻ Nouvelles idées
              </button>
            </div>

            <div className="reco-platform-tabs" aria-label="Filtrer les recommandations par plateforme">
              <button
                className={ideaPlatformFilter === "all" ? "active" : ""}
                type="button"
                onClick={() => setIdeaPlatformFilter("all")}
              >
                Toutes <b>{learnedIdeas.length}</b>
              </button>
              {PLATFORM_ORDER.map((key) => (
                <button
                  className={`tone-${PLATFORM_META[key].tone} ${ideaPlatformFilter === key ? "active" : ""}`}
                  type="button"
                  onClick={() => setIdeaPlatformFilter(key)}
                  key={key}
                >
                  {PLATFORM_META[key].emoji} {PLATFORM_META[key].label} <b>{ideaPlatformCounts[key]}</b>
                </button>
              ))}
              {editorialWorkflowSyncing ? <span className="workflow-syncing">Synchronisation…</span> : null}
            </div>

            {historyLoading || !editorialWorkflowReady ? (
              <HistoryLoadingState
                loadedPlatformCount={loadedPlatformCount}
                label="Génération des recommandations à partir de l’historique complet"
              />
            ) : visibleIdeas.length ? (
              <div className="reco-grid">
                {visibleIdeas.map((idea) => (
                  <RecommendationCard
                    idea={idea}
                    decision={editorialWorkflow.feedback[idea.id]?.decision}
                    disabled={editorialWorkflowSyncing}
                    onDecision={setIdeaDecision}
                    onInspect={setActiveRecommendation}
                    key={idea.id}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state reco-empty-state">
                <span>🧭</span>
                <h3>Aucune recommandation dans ce filtre</h3>
                <p>Change de plateforme ou affiche un autre état.</p>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setIdeaPlatformFilter("all");
                    setIdeaStatusFilter("pending");
                  }}
                >
                  Voir les recommandations à valider
                </button>
              </div>
            )}
          </div>
        ) : null}

        {workspace && view === "planning" ? (
          <RoadmapBoard
            schedule={editorialWorkflow.schedule}
            syncing={editorialWorkflowSyncing}
            onReschedule={rescheduleIdea}
            onOpenRecommendations={() => {
              setIdeaStatusFilter("pending");
              setView("ideas");
            }}
          />
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

              <div className="top-sort-control-row">
                <span className="section-kicker">Trier</span>
                <div className="format-filter-tabs top-sort-tabs" role="group" aria-label="Trier les publications">
                  <button className={topSort === "popular" ? "active" : ""} type="button" aria-pressed={topSort === "popular"} onClick={() => setTopSort("popular")}>
                    🏆 Plus populaire
                  </button>
                  <button className={topSort === "recent" ? "active" : ""} type="button" aria-pressed={topSort === "recent"} onClick={() => setTopSort("recent")}>
                    🗓️ Plus récent
                  </button>
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
                    const loadedCount = topPlatformPosts.filter((post) =>
                      matchesSocialFormatFilter(post, filter.key),
                    ).length;
                    const count =
                      topPlatformPending && topDuration === "all"
                        ? publicFormatCounts?.[topPlatform]?.[filter.key] ?? loadedCount
                        : loadedCount;
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

              {topPlatformPending ? (
                <HistoryLoadingState
                  loadedPlatformCount={loadedPlatformCount}
                  label={`Chargement des fiches ${PLATFORM_META[topPlatform].label}`}
                />
              ) : topFilteredPosts.length ? (
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
              <div className="format-filter-tabs library-sort-tabs" role="group" aria-label="Trier les publications de la catégorie">
                <button className={librarySort === "popular" ? "active" : ""} type="button" aria-pressed={librarySort === "popular"} onClick={() => setLibrarySort("popular")}>
                  🏆 Plus populaire
                </button>
                <button className={librarySort === "recent" ? "active" : ""} type="button" aria-pressed={librarySort === "recent"} onClick={() => setLibrarySort("recent")}>
                  🗓️ Plus récent
                </button>
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

      <PostDetailsModal
        post={activeDetailsPost}
        editorialAnalysis={activeDetailsAnalysis}
        onClose={closeActiveDetails}
      />
      <RecommendationDetailsModal
        idea={activeRecommendation}
        onClose={closeActiveRecommendation}
      />
      {toast ? <div className="toast">✅ {toast}</div> : null}
    </div>
  );
}

function HistoryLoadingState({
  loadedPlatformCount,
  label,
  compact = false,
}: {
  loadedPlatformCount: number;
  label: string;
  compact?: boolean;
}) {
  const progress = Math.max(0, Math.min(100, (loadedPlatformCount / 4) * 100));
  return (
    <div className={`history-loading-state ${compact ? "compact" : ""}`} role="status">
      <span className="history-loading-icon" aria-hidden="true">⏳</span>
      <div>
        <b>{label}</b>
        <small>
          Les vrais compteurs sont déjà affichés · {loadedPlatformCount}/4 réseaux prêts
        </small>
        <span className="history-loading-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      </div>
    </div>
  );
}

function recommendationTier(score: number) {
  if (score >= 80) return "S";
  if (score >= 65) return "A";
  return "B";
}

function RecommendationCard({
  idea,
  decision,
  disabled,
  onDecision,
  onInspect,
}: {
  idea: LearnedIdea;
  decision?: IdeaDecision;
  disabled: boolean;
  onDecision: (idea: SocialIdea, decision: IdeaDecision) => void;
  onInspect: (idea: LearnedIdea) => void;
}) {
  const primaryMeta = PLATFORM_META[idea.primaryPlatform];
  const primaryAdaptation = idea.platformAdaptations[idea.primaryPlatform];
  const tier = recommendationTier(idea.learnedPotentialScore);

  return (
    <article className={`reco-card tone-${primaryMeta.tone} decision-${decision ?? "pending"}`}>
      <button
        className="reco-card-main"
        type="button"
        onClick={() => onInspect(idea)}
        aria-label={`Voir le détail de la recommandation ${idea.title}`}
      >
        <header className="reco-card-head">
          <span
            className={`reco-tier tier-${tier.toLowerCase()}`}
            title={`${idea.learnedPotentialScore}/100 de potentiel`}
            aria-label={`Tier ${tier}, potentiel ${idea.learnedPotentialScore} sur 100`}
          >
            {tier}
          </span>
          <h3>{idea.title}</h3>
        </header>
        <div className="reco-tags">
          <span className={`platform-tag tone-${primaryMeta.tone}`}>
            {primaryMeta.emoji} {primaryMeta.label}
          </span>
          <span title={primaryAdaptation.format}>{primaryAdaptation.format}</span>
        </div>
        <p className="reco-description">{idea.observedSignal.summary}</p>
        <p className="reco-hook">« {idea.hook} »</p>
        <span className="reco-more">Voir pourquoi elle a du potentiel →</span>
      </button>

      <footer className="reco-quick-actions" aria-label="Décider et entraîner le classement">
        <button
          className="reco-action edit"
          type="button"
          disabled={disabled}
          aria-pressed={decision === "rework"}
          onClick={() => void onDecision(idea, "rework")}
        >
          ✎ Modifier
        </button>
        <button
          className="reco-action refuse"
          type="button"
          disabled={disabled}
          aria-pressed={decision === "discard"}
          onClick={() => void onDecision(idea, "discard")}
        >
          ✕ Refuser
        </button>
        <button
          className="reco-action validate"
          type="button"
          disabled={disabled}
          aria-pressed={decision === "produce"}
          onClick={() => void onDecision(idea, "produce")}
        >
          ✓ Valider
        </button>
      </footer>
    </article>
  );
}

function RecommendationDetailsModal({
  idea,
  onClose,
}: {
  idea: LearnedIdea | null;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const isOpen = Boolean(idea);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  if (!idea) return null;
  const primaryMeta = PLATFORM_META[idea.primaryPlatform];
  const tier = recommendationTier(idea.learnedPotentialScore);

  return (
    <div
      className="post-details-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`post-details-modal recommendation-details-modal tone-${primaryMeta.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-details-title"
        ref={modalRef}
      >
        <header>
          <div>
            <span>{primaryMeta.emoji} Recommandation {primaryMeta.label} · Tier {tier}</span>
            <h2 id="recommendation-details-title">{idea.title}</h2>
            <small className="details-theme-label">{idea.learnedPotentialScore}/100 de potentiel · #{idea.platformRank} sur {primaryMeta.label}</small>
          </div>
          <button
            className="post-details-close"
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
            aria-label="Fermer la recommandation"
          >
            ✕
          </button>
        </header>

        <div className="recommendation-detail-grid">
          <section className="recommendation-detail-panel featured">
            <span className="section-kicker">📡 Pourquoi elle a du potentiel</span>
            <p>{idea.observedSignal.summary}</p>
            <small>{idea.learningExplanation}</small>
          </section>
          <section className="recommendation-detail-panel">
            <span className="section-kicker">🎬 Format proposé</span>
            <p>{idea.proposedFormat}</p>
          </section>
          <section className="recommendation-detail-panel">
            <span className="section-kicker">🪝 Hook</span>
            <p>« {idea.hook} »</p>
          </section>
        </div>

        <section className="recommendation-detail-section">
          <span className="section-kicker">Posts sources</span>
          <div className="recommendation-source-links">
            {idea.seedPosts.map((seed) => (
              <a href={seed.url} target="_blank" rel="noreferrer" key={`${seed.platform}:${seed.externalId}`}>
                <span>{PLATFORM_META[seed.platform].emoji}</span>
                <b>{PLATFORM_META[seed.platform].label}</b>
                <small>Post #{seed.platformRank ?? "—"}</small>
                <strong>↗</strong>
              </a>
            ))}
          </div>
        </section>

        <section className="recommendation-detail-section">
          <span className="section-kicker">Déclinaisons possibles</span>
          <div className="idea-platform-grid recommendation-platform-grid">
            {PLATFORM_ORDER.map((platform) => {
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
        </section>

        <div className="recommendation-caveat">
          <span>🧪</span>
          <p>{idea.confidenceRationale}</p>
        </div>
      </section>
    </div>
  );
}

type RoadmapScale = "month" | "year";
type RoadmapDisplayMode = "list" | "calendar";

const ROADMAP_WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function roadmapCalendarCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const leadingDays = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(Date.UTC(year, month, index - leadingDays + 1)),
  );
}

function roadmapDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function roadmapMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));
}

function RoadmapBoard({
  schedule,
  syncing,
  onReschedule,
  onOpenRecommendations,
}: {
  schedule: ScheduledIdea[];
  syncing: boolean;
  onReschedule: (ideaId: string, scheduledFor: string) => void;
  onOpenRecommendations: () => void;
}) {
  const now = new Date();
  const [scale, setScale] = useState<RoadmapScale>("year");
  const [displayMode, setDisplayMode] = useState<RoadmapDisplayMode>("calendar");
  const [cursorYear, setCursorYear] = useState(now.getFullYear());
  const [cursorMonth, setCursorMonth] = useState(now.getMonth());
  const [platformFilter, setPlatformFilter] = useState<IdeaPlatformFilter>("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const closeSelectedDay = useCallback(() => setSelectedDay(null), []);
  const sortedSchedule = [...schedule].sort((left, right) =>
    left.scheduledFor.localeCompare(right.scheduledFor) || left.platform.localeCompare(right.platform),
  );
  const filteredSchedule = sortedSchedule.filter((item) => {
    if (platformFilter !== "all" && item.platform !== platformFilter) return false;
    const yearMatches = Number(item.scheduledFor.slice(0, 4)) === cursorYear;
    if (!yearMatches) return false;
    return scale === "year" || Number(item.scheduledFor.slice(5, 7)) - 1 === cursorMonth;
  });
  const scheduleByDate = new Map<string, ScheduledIdea[]>();
  for (const item of filteredSchedule) {
    const existing = scheduleByDate.get(item.scheduledFor) ?? [];
    existing.push(item);
    scheduleByDate.set(item.scheduledFor, existing);
  }
  const selectedItems = selectedDay
    ? sortedSchedule.filter((item) =>
        item.scheduledFor === selectedDay
        && (platformFilter === "all" || item.platform === platformFilter),
      )
    : [];
  const periodLabel = scale === "year"
    ? String(cursorYear)
    : roadmapMonthLabel(cursorYear, cursorMonth);

  const movePeriod = (direction: -1 | 1) => {
    if (scale === "year") {
      setCursorYear((year) => year + direction);
      return;
    }
    const next = new Date(Date.UTC(cursorYear, cursorMonth + direction, 1));
    setCursorYear(next.getUTCFullYear());
    setCursorMonth(next.getUTCMonth());
  };

  return (
    <div className="roadmap-view">
      <header className="roadmap-heading">
        <h2>Roadmap</h2>
        {syncing ? <span className="workflow-syncing">Synchronisation…</span> : null}
      </header>

      <div className="roadmap-controls">
        <div className="roadmap-scale-toggle" aria-label="Période de la roadmap">
          <button className={scale === "month" ? "active" : ""} type="button" onClick={() => setScale("month")}>Mois</button>
          <button className={scale === "year" ? "active" : ""} type="button" onClick={() => setScale("year")}>Année</button>
        </div>
        <div className="roadmap-period-navigation">
          <button type="button" aria-label="Période précédente" onClick={() => movePeriod(-1)}>‹</button>
          <strong>{periodLabel}</strong>
          <button type="button" aria-label="Période suivante" onClick={() => movePeriod(1)}>›</button>
        </div>
        <div className="roadmap-display-toggle" aria-label="Affichage de la roadmap">
          <button className={displayMode === "list" ? "active" : ""} type="button" aria-label="Liste" onClick={() => setDisplayMode("list")}>☰</button>
          <button className={displayMode === "calendar" ? "active" : ""} type="button" aria-label="Calendrier" onClick={() => setDisplayMode("calendar")}>▣</button>
        </div>
      </div>

      {displayMode === "list" ? (
        <RoadmapList
          items={filteredSchedule}
          syncing={syncing}
          onReschedule={onReschedule}
          onOpenRecommendations={onOpenRecommendations}
        />
      ) : (
        <div className="roadmap-calendar-shell">
          {scale === "year" ? (
            <div className="roadmap-year-grid">
              {Array.from({ length: 12 }, (_, month) => (
                <RoadmapMiniMonth
                  year={cursorYear}
                  month={month}
                  scheduleByDate={scheduleByDate}
                  onSelectDay={setSelectedDay}
                  key={`${cursorYear}-${month}`}
                />
              ))}
            </div>
          ) : (
            <RoadmapMonth
              year={cursorYear}
              month={cursorMonth}
              scheduleByDate={scheduleByDate}
              onSelectDay={setSelectedDay}
            />
          )}
          <RoadmapLegend
            schedule={schedule}
            activePlatform={platformFilter}
            onChange={setPlatformFilter}
          />
        </div>
      )}

      {!schedule.length ? (
        <button className="roadmap-empty-cta" type="button" onClick={onOpenRecommendations}>
          💡 Valider une recommandation pour remplir la roadmap
        </button>
      ) : null}

      <RoadmapDayModal
        date={selectedDay}
        items={selectedItems}
        syncing={syncing}
        onReschedule={(ideaId, scheduledFor) => {
          onReschedule(ideaId, scheduledFor);
          closeSelectedDay();
        }}
        onClose={closeSelectedDay}
      />
    </div>
  );
}

function RoadmapMiniMonth({
  year,
  month,
  scheduleByDate,
  onSelectDay,
}: {
  year: number;
  month: number;
  scheduleByDate: Map<string, ScheduledIdea[]>;
  onSelectDay: (date: string) => void;
}) {
  return (
    <section className="roadmap-mini-month">
      <h3>{new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1)))}</h3>
      <div className="roadmap-weekdays" aria-hidden="true">
        {ROADMAP_WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className="roadmap-mini-days">
        {roadmapCalendarCells(year, month).map((date) => {
          const key = roadmapDateKey(date);
          const outside = date.getUTCMonth() !== month;
          const items = outside ? [] : (scheduleByDate.get(key) ?? []);
          const primary = items[0];
          return items.length ? (
            <button
              className={`roadmap-mini-event tone-${PLATFORM_META[primary.platform].tone} ${items.length > 1 ? "multiple" : ""}`}
              type="button"
              title={items.map((item) => item.title).join(" · ")}
              aria-label={`${date.getUTCDate()} ${roadmapMonthLabel(year, month)}, ${items.length} publication${items.length > 1 ? "s" : ""}`}
              onClick={() => onSelectDay(key)}
              key={key}
            >
              {date.getUTCDate()}
              {items.length > 1 ? <small>{items.length}</small> : null}
            </button>
          ) : (
            <span className={outside ? "outside" : ""} key={key}>{date.getUTCDate()}</span>
          );
        })}
      </div>
    </section>
  );
}

function RoadmapMonth({
  year,
  month,
  scheduleByDate,
  onSelectDay,
}: {
  year: number;
  month: number;
  scheduleByDate: Map<string, ScheduledIdea[]>;
  onSelectDay: (date: string) => void;
}) {
  return (
    <section className="roadmap-month-calendar">
      <div className="roadmap-month-weekdays" aria-hidden="true">
        {["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="roadmap-month-days">
        {roadmapCalendarCells(year, month).map((date) => {
          const key = roadmapDateKey(date);
          const outside = date.getUTCMonth() !== month;
          const items = outside ? [] : (scheduleByDate.get(key) ?? []);
          return (
            <div className={`roadmap-month-day ${outside ? "outside" : ""} ${items.length ? "has-events" : ""}`} key={key}>
              <span className="roadmap-month-day-number">{date.getUTCDate()}</span>
              <div className="roadmap-month-events">
                {items.map((item) => (
                  <button
                    className={`roadmap-month-event tone-${PLATFORM_META[item.platform].tone}`}
                    type="button"
                    title={item.title}
                    onClick={() => onSelectDay(key)}
                    key={item.id}
                  >
                    <span>{PLATFORM_META[item.platform].emoji}</span>
                    <b>{item.title}</b>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RoadmapLegend({
  schedule,
  activePlatform,
  onChange,
}: {
  schedule: ScheduledIdea[];
  activePlatform: IdeaPlatformFilter;
  onChange: (platform: IdeaPlatformFilter) => void;
}) {
  return (
    <aside className="roadmap-legend" aria-label="Légende et filtre des plateformes">
      <button className={activePlatform === "all" ? "active" : ""} type="button" onClick={() => onChange("all")}>
        <span className="legend-all">×</span><b>Toutes</b><small>{schedule.length}</small>
      </button>
      {PLATFORM_ORDER.map((platform) => {
        const meta = PLATFORM_META[platform];
        const count = schedule.filter((item) => item.platform === platform).length;
        return (
          <button
            className={`${activePlatform === platform ? "active" : ""} tone-${meta.tone}`}
            type="button"
            onClick={() => onChange(platform)}
            key={platform}
          >
            <span>{meta.emoji}</span><b>{meta.label}</b><small>{count}</small>
          </button>
        );
      })}
    </aside>
  );
}

function RoadmapList({
  items,
  syncing,
  onReschedule,
  onOpenRecommendations,
}: {
  items: ScheduledIdea[];
  syncing: boolean;
  onReschedule: (ideaId: string, scheduledFor: string) => void;
  onOpenRecommendations: () => void;
}) {
  if (!items.length) {
    return (
      <div className="empty-state roadmap-list-empty">
        <span>🗓️</span>
        <h3>Aucune publication sur cette période</h3>
        <p>Valide une recommandation ou change de période.</p>
        <button className="button primary" type="button" onClick={onOpenRecommendations}>Voir les recommandations</button>
      </div>
    );
  }

  return (
    <div className="roadmap-list">
      {items.map((item) => (
        <article className={`roadmap-list-card tone-${PLATFORM_META[item.platform].tone}`} key={item.id}>
          <time dateTime={item.scheduledFor}>
            <b>{item.scheduledFor.slice(8, 10)}</b>
            <span>{new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.scheduledFor}T12:00:00.000Z`))}</span>
          </time>
          <span className="roadmap-list-platform" aria-hidden="true">{PLATFORM_META[item.platform].emoji}</span>
          <div>
            <small>{PLATFORM_META[item.platform].label} · {item.format}</small>
            <h3>{item.title}</h3>
            <p>« {item.hook} »</p>
          </div>
          <label>
            Modifier la date
            <input
              type="date"
              disabled={syncing}
              value={item.scheduledFor}
              onChange={(event) => onReschedule(item.ideaId, event.target.value)}
            />
          </label>
        </article>
      ))}
    </div>
  );
}

function RoadmapDayModal({
  date,
  items,
  syncing,
  onReschedule,
  onClose,
}: {
  date: string | null;
  items: ScheduledIdea[];
  syncing: boolean;
  onReschedule: (ideaId: string, scheduledFor: string) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const isOpen = Boolean(date && items.length);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
        modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? [],
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

  if (!date || !items.length) return null;
  return (
    <div className="post-details-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="roadmap-day-modal" role="dialog" aria-modal="true" aria-labelledby="roadmap-day-title" ref={modalRef}>
        <header>
          <div>
            <span className="section-kicker">🗓️ Publication{items.length > 1 ? "s" : ""} planifiée{items.length > 1 ? "s" : ""}</span>
            <h2 id="roadmap-day-title">{formatCardPublishedDate(`${date}T12:00:00.000Z`)}</h2>
          </div>
          <button className="post-details-close" type="button" onClick={onClose} ref={closeButtonRef} aria-label="Fermer">✕</button>
        </header>
        <div className="roadmap-day-modal-list">
          {items.map((item) => (
            <article className={`tone-${PLATFORM_META[item.platform].tone}`} key={item.id}>
              <span>{PLATFORM_META[item.platform].emoji}</span>
              <div>
                <small>{PLATFORM_META[item.platform].label} · {item.format}</small>
                <h3>{item.title}</h3>
                <p>« {item.hook} »</p>
              </div>
              <label>
                Modifier la date
                <input
                  type="date"
                  disabled={syncing}
                  value={item.scheduledFor}
                  onChange={(event) => onReschedule(item.ideaId, event.target.value)}
                />
              </label>
            </article>
          ))}
        </div>
      </section>
    </div>
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
      className={`social-post-card ${compact ? "compact" : ""} ${hasMediaPreview ? "has-media" : "text-only"} ${choices.length ? "poll-card" : ""}`}
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
  editorialAnalysis,
  onClose,
}: {
  post: SocialPost | null;
  editorialAnalysis: EditorialWhy | null;
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
  const detailTheme = postLabel(post, editorialAnalysis);
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
