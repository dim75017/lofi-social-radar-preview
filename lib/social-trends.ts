export type TrendPlatform = "instagram" | "tiktok" | "youtube" | "x";
export type TrendLifecycle = "new" | "rising" | "peaking" | "steady" | "watch";
export type TrendConfidence = "high" | "medium" | "watch";
export type TrendTone = "complice" | "cozy" | "absurde";

export type TrendObservation = {
  id: string;
  platform: TrendPlatform;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  windowLabel: string;
  signal: string;
  rank: number | null;
  posts: number | null;
  views: number | null;
  uses: number | null;
  exactness: "exact" | "platform-estimate" | "editorial-observation";
};

export type TrendProposal = {
  tone: TrendTone;
  label: string;
  title: string;
  concept: string;
  copy: string;
};

export type TrendReferencePost = {
  platform: TrendPlatform;
  author: string | null;
  caption: string;
  url: string;
  mediaType: "image" | "video" | "text" | "unknown";
  thumbnailUrl: string | null;
  publishedAt: string | null;
  capturedAt: string;
  selectionLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  exactness: TrendObservation["exactness"];
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
};

export type SocialTrend = {
  id: string;
  title: string;
  type: "hashtag" | "sound" | "spoken-audio" | "meme-template" | "format" | "moment";
  summary: string;
  mechanic: string;
  platforms: TrendPlatform[];
  keywords: string[];
  lifecycle: TrendLifecycle;
  confidence: TrendConfidence;
  momentumScore: number;
  lofiFitScore: number;
  saturationRisk: number;
  whyLofi: string;
  timing: string;
  production: string;
  caveat: string;
  referencePost: TrendReferencePost | null;
  observations: TrendObservation[];
  proposals: TrendProposal[];
};

export type SocialTrendFeed = {
  version: 2;
  capturedAt: string;
  market: string;
  methodology: string;
  trends: SocialTrend[];
};

const CONFIDENCE_WEIGHT: Record<TrendConfidence, number> = {
  high: 100,
  medium: 76,
  watch: 52,
};

export const TREND_PRIORITY_THRESHOLD = 90;

export function trendPriorityScore(trend: SocialTrend) {
  const saturationPenalty = Math.max(0, trend.saturationRisk - 55) * 0.16;
  return Math.max(
    0,
    Math.min(
      99,
      Math.round(
        trend.lofiFitScore * 0.5 +
          trend.momentumScore * 0.35 +
          CONFIDENCE_WEIGHT[trend.confidence] * 0.15 -
          saturationPenalty,
      ),
    ),
  );
}

export function rankSocialTrends(trends: readonly SocialTrend[]) {
  return [...trends].sort((left, right) => {
    const scoreDelta = trendPriorityScore(right) - trendPriorityScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    if (right.lofiFitScore !== left.lofiFitScore) {
      return right.lofiFitScore - left.lofiFitScore;
    }
    return left.title.localeCompare(right.title, "fr");
  });
}

export function filterSocialTrends(
  trends: readonly SocialTrend[],
  options: {
    platform?: TrendPlatform | "all";
    lifecycle?: TrendLifecycle | "all" | "priority";
  } = {},
) {
  const platform = options.platform ?? "all";
  const lifecycle = options.lifecycle ?? "all";
  return rankSocialTrends(
    trends.filter((trend) => {
      if (platform !== "all" && !trend.platforms.includes(platform)) return false;
      if (lifecycle === "priority") {
        return trendPriorityScore(trend) >= TREND_PRIORITY_THRESHOLD;
      }
      if (lifecycle !== "all" && trend.lifecycle !== lifecycle) return false;
      return true;
    }),
  );
}

export function assertSocialTrendFeed(value: unknown): SocialTrendFeed {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot Trends invalide.");
  }
  const feed = value as SocialTrendFeed;
  const isText = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && candidate.trim().length > 0;
  const isScore = (candidate: unknown): candidate is number =>
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0 &&
    candidate <= 100;
  const isWebUrl = (candidate: unknown) => {
    if (!isText(candidate)) return false;
    try {
      const url = new URL(candidate);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  };
  const validPlatforms = new Set<TrendPlatform>(["instagram", "tiktok", "youtube", "x"]);
  const validLifecycles = new Set<TrendLifecycle>(["new", "rising", "peaking", "steady", "watch"]);
  const validConfidences = new Set<TrendConfidence>(["high", "medium", "watch"]);
  const validTypes = new Set<SocialTrend["type"]>([
    "hashtag",
    "sound",
    "spoken-audio",
    "meme-template",
    "format",
    "moment",
  ]);
  const validExactness = new Set<TrendObservation["exactness"]>([
    "exact",
    "platform-estimate",
    "editorial-observation",
  ]);
  const validMediaTypes = new Set<TrendReferencePost["mediaType"]>([
    "image",
    "video",
    "text",
    "unknown",
  ]);
  const isNullableMetric = (candidate: unknown) =>
    candidate === null ||
    (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0);
  const isReferenceUrlForPlatform = (candidate: string, platform: TrendPlatform) => {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/\/+$/, "");
      if (url.protocol !== "https:") return false;
      if (platform === "instagram") {
        return (host === "instagram.com" || host.endsWith(".instagram.com")) &&
          /^\/(?:p|reel)\/[^/]+$/i.test(path);
      }
      if (platform === "tiktok") {
        return (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
          /^\/@[^/]+\/video\/\d{12,24}$/i.test(path);
      }
      if (platform === "youtube") {
        return (host === "youtube.com" || host.endsWith(".youtube.com")) &&
          /^\/shorts\/[A-Za-z0-9_-]{11}$/i.test(path);
      }
      return (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) &&
        /^\/[^/]+\/status\/\d+$/i.test(path);
    } catch {
      return false;
    }
  };

  if (
    feed?.version !== 2 ||
    !isText(feed.capturedAt) ||
    !Number.isFinite(Date.parse(feed.capturedAt)) ||
    !isText(feed.market) ||
    !isText(feed.methodology) ||
    !Array.isArray(feed.trends)
  ) {
    throw new Error("Snapshot Trends invalide.");
  }
  const ids = new Set<string>();
  const observationIds = new Set<string>();
  for (const trend of feed.trends) {
    if (!trend || typeof trend !== "object") {
      throw new Error("Trend incomplète ou invalide.");
    }
    if (!trend.id || ids.has(trend.id)) throw new Error(`Trend dupliquée : ${trend.id}`);
    ids.add(trend.id);
    if (
      !isText(trend.title) ||
      !validTypes.has(trend.type) ||
      !isText(trend.summary) ||
      !isText(trend.mechanic) ||
      !Array.isArray(trend.platforms) ||
      !trend.platforms.length ||
      trend.platforms.some((platform) => !validPlatforms.has(platform)) ||
      !Array.isArray(trend.keywords) ||
      trend.keywords.some((keyword) => !isText(keyword)) ||
      !validLifecycles.has(trend.lifecycle) ||
      !validConfidences.has(trend.confidence) ||
      !isScore(trend.momentumScore) ||
      !isScore(trend.lofiFitScore) ||
      !isScore(trend.saturationRisk) ||
      !isText(trend.whyLofi) ||
      !isText(trend.timing) ||
      !isText(trend.production) ||
      !isText(trend.caveat) ||
      !Object.prototype.hasOwnProperty.call(trend, "referencePost")
    ) {
      throw new Error(`Trend incomplète ou invalide : ${trend.id}`);
    }
    const referencePost = trend.referencePost;
    if (referencePost !== null) {
      if (!referencePost || typeof referencePost !== "object") {
        throw new Error(`Post de référence invalide : ${trend.id}`);
      }
      const metrics = referencePost.metrics;
      if (
        !validPlatforms.has(referencePost.platform) ||
        !trend.platforms.includes(referencePost.platform) ||
        (referencePost.author !== null && !isText(referencePost.author)) ||
        !isText(referencePost.caption) ||
        !isReferenceUrlForPlatform(referencePost.url, referencePost.platform) ||
        !validMediaTypes.has(referencePost.mediaType) ||
        (referencePost.thumbnailUrl !== null && !isWebUrl(referencePost.thumbnailUrl)) ||
        (referencePost.publishedAt !== null &&
          (!isText(referencePost.publishedAt) || !Number.isFinite(Date.parse(referencePost.publishedAt)))) ||
        !isText(referencePost.capturedAt) ||
        !Number.isFinite(Date.parse(referencePost.capturedAt)) ||
        Date.parse(referencePost.capturedAt) > Date.parse(feed.capturedAt) ||
        !isText(referencePost.selectionLabel) ||
        !isText(referencePost.sourceLabel) ||
        !isWebUrl(referencePost.sourceUrl) ||
        !validExactness.has(referencePost.exactness) ||
        !metrics ||
        !isNullableMetric(metrics.views) ||
        !isNullableMetric(metrics.likes) ||
        !isNullableMetric(metrics.comments) ||
        !isNullableMetric(metrics.shares) ||
        (referencePost.exactness === "editorial-observation" &&
          [metrics.views, metrics.likes, metrics.comments, metrics.shares].some((metric) => metric !== null))
      ) {
        throw new Error(`Post de référence invalide : ${trend.id}`);
      }
    }
    if (!Array.isArray(trend.observations) || !trend.observations.length) {
      throw new Error(`Trend sans source : ${trend.id}`);
    }
    if (!Array.isArray(trend.proposals)) throw new Error(`Propositions absentes : ${trend.id}`);
    if (trend.proposals.length !== 3) throw new Error(`Trois tons requis : ${trend.id}`);
    const tones = new Set(trend.proposals.map((proposal) => proposal.tone));
    if (tones.size !== 3 || !tones.has("complice") || !tones.has("cozy") || !tones.has("absurde")) {
      throw new Error(`Tons incomplets : ${trend.id}`);
    }
    for (const proposal of trend.proposals) {
      if (
        !isText(proposal.label) ||
        !isText(proposal.title) ||
        !isText(proposal.concept) ||
        !isText(proposal.copy)
      ) {
        throw new Error(`Proposition incomplète : ${trend.id}`);
      }
    }
    for (const observation of trend.observations) {
      if (
        !isText(observation.id) ||
        observationIds.has(observation.id) ||
        !validPlatforms.has(observation.platform) ||
        !isText(observation.sourceLabel) ||
        !isWebUrl(observation.sourceUrl) ||
        !isText(observation.observedAt) ||
        !Number.isFinite(Date.parse(observation.observedAt)) ||
        !isText(observation.windowLabel) ||
        !isText(observation.signal) ||
        !validExactness.has(observation.exactness)
      ) {
        throw new Error(`Observation invalide : ${trend.id}`);
      }
      observationIds.add(observation.id);
      for (const metric of [observation.rank, observation.posts, observation.views, observation.uses]) {
        if (metric !== null && (!Number.isFinite(metric) || metric < 0)) {
          throw new Error(`Métrique invalide : ${trend.id}`);
        }
      }
    }
  }
  return feed;
}

export function latestTrendObservation(trend: SocialTrend) {
  return [...trend.observations].sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt),
  )[0];
}
