export type CommentOpportunityPlatform = "instagram" | "tiktok" | "youtube" | "x";
export type CommentOpportunityStatus = "surging" | "hot" | "watch";
export type CommentOpportunityTone = "funny" | "smart" | "complice";
export type CommentOpportunityRiskLevel = "low" | "medium";
export type CommentOpportunityExactness = "exact" | "platform-estimate" | "unavailable";

export type CommentOpportunityMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

export type CommentOpportunityObservation = CommentOpportunityMetrics & {
  capturedAt: string;
  sourceLabel: string;
  sourceUrl: string;
  exactness: CommentOpportunityExactness;
};

export type CommentSuggestion = {
  tone: CommentOpportunityTone;
  label: string;
  text: string;
};

export type CommentOpportunity = {
  id: string;
  platform: CommentOpportunityPlatform;
  author: string;
  title: string;
  caption: string;
  url: string;
  mediaType: "video";
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  capturedAt: string;
  status: CommentOpportunityStatus;
  lofiFitScore: number;
  commentabilityScore: number;
  priorityScore: number;
  whyNow: string;
  risk: {
    level: CommentOpportunityRiskLevel;
    note: string;
  };
  metrics: CommentOpportunityMetrics;
  observations: CommentOpportunityObservation[];
  comments: CommentSuggestion[];
};

export type CommentOpportunitySourceCheck = {
  id: string;
  platform: CommentOpportunityPlatform;
  status: "success" | "limited" | "failed";
  checkedAt: string;
  label: string;
};

export type CommentOpportunityFeed = {
  version: 1;
  capturedAt: string;
  nextRefreshAt: string;
  cadenceHours: 6;
  sourceChecks: CommentOpportunitySourceCheck[];
  opportunities: CommentOpportunity[];
};

export const COMMENT_OPPORTUNITY_REFRESH_CADENCE_HOURS = 6;
export const COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH = 160;

const HOUR_IN_MILLISECONDS = 60 * 60 * 1_000;
const METRIC_KEYS = ["views", "likes", "comments", "shares"] as const;
const VALID_PLATFORMS = new Set<CommentOpportunityPlatform>([
  "instagram",
  "tiktok",
  "youtube",
  "x",
]);
const VALID_STATUSES = new Set<CommentOpportunityStatus>([
  "surging",
  "hot",
  "watch",
]);
const VALID_TONES = new Set<CommentOpportunityTone>([
  "funny",
  "smart",
  "complice",
]);
const VALID_EXACTNESS = new Set<CommentOpportunityExactness>([
  "exact",
  "platform-estimate",
  "unavailable",
]);
const VALID_RISK_LEVELS = new Set<CommentOpportunityRiskLevel>([
  "low",
  "medium",
]);

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isNullablePublicMetric(value: unknown) {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isScore(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100;
}

function normalizeComment(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function metricsMatch(
  left: CommentOpportunityMetrics,
  right: CommentOpportunityMetrics,
) {
  return METRIC_KEYS.every((key) => left[key] === right[key]);
}

function hasAnyMetric(metrics: CommentOpportunityMetrics) {
  return METRIC_KEYS.some((key) => metrics[key] !== null);
}

function isPromotionalComment(text: string) {
  const containsLink = /(?:https?:\/\/|www\.)/iu.test(text);
  const containsHashtag = /(?:^|\s)#[\p{L}\p{N}_-]+/iu.test(text);
  const containsPromotion = /(?:\bfollow\b|\bsubscribe\b|\bstream\b|\blisten\s+to\b|\bcheck\s+out\b|\blink\s+in\s+bio\b|\bour\s+(?:channel|playlist|music|album|radio)\b|\blofi\s+girl\s+(?:channel|playlist|music|radio)\b)/iu.test(text);
  return containsLink || containsHashtag || containsPromotion;
}

export function isNativeCommentOpportunityUrl(
  candidate: string,
  platform: CommentOpportunityPlatform,
) {
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if (url.protocol !== "https:") return false;
    if (platform === "instagram") {
      return (host === "instagram.com" || host.endsWith(".instagram.com")) &&
        /^\/(?:reel|reels)\/[^/]+$/iu.test(path);
    }
    if (platform === "tiktok") {
      return (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
        /^\/@[^/]+\/video\/\d{12,24}$/iu.test(path);
    }
    if (platform === "youtube") {
      return (host === "youtube.com" || host.endsWith(".youtube.com")) &&
        /^\/shorts\/[A-Za-z0-9_-]{11}$/u.test(path);
    }
    return (
      host === "x.com" ||
      host.endsWith(".x.com") ||
      host === "twitter.com" ||
      host.endsWith(".twitter.com")
    ) && /^\/[^/]+\/status\/\d+$/iu.test(path);
  } catch {
    return false;
  }
}

function canonicalOpportunityIdentity(opportunity: Pick<CommentOpportunity, "platform" | "url">) {
  const url = new URL(opportunity.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const nativeId = opportunity.platform === "instagram" || opportunity.platform === "youtube"
    ? segments[1]
    : segments.at(-1);
  return `${opportunity.platform}:${nativeId}`;
}

/**
 * "Surging" is reserved for a measured increase on the same public counter.
 * A single large counter is strong performance, but it is not acceleration.
 */
export function hasCommentOpportunityAccelerationEvidence(
  opportunity: CommentOpportunity,
) {
  if (opportunity.observations.length < 2) return false;
  const first = opportunity.observations[0];
  const latest = opportunity.observations.at(-1);
  if (!latest || Date.parse(latest.capturedAt) <= Date.parse(first.capturedAt)) {
    return false;
  }
  return METRIC_KEYS.some((key) => {
    const before = first[key];
    const after = latest[key];
    return before !== null && after !== null && after > before;
  });
}

/**
 * Editorial-only composite: it deliberately ignores raw cross-platform
 * counters, which are not comparable between Instagram, TikTok, YouTube and X.
 */
export function commentOpportunityPriorityScore(
  opportunity: Pick<CommentOpportunity, "lofiFitScore" | "commentabilityScore">,
) {
  return Math.round(
    opportunity.lofiFitScore * 0.55 + opportunity.commentabilityScore * 0.45,
  );
}

export function commentOpportunityFreshnessScore(
  opportunity: Pick<CommentOpportunity, "publishedAt" | "capturedAt">,
  referenceAt = opportunity.capturedAt,
) {
  if (opportunity.publishedAt === null) return 45;
  const publishedAt = Date.parse(opportunity.publishedAt);
  const referenceTimestamp = Date.parse(referenceAt);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(referenceTimestamp)) return 0;
  const ageHours = Math.max(0, (referenceTimestamp - publishedAt) / HOUR_IN_MILLISECONDS);
  return Math.round(100 * 2 ** (-ageHours / 48));
}

export function commentOpportunityRankScore(
  opportunity: Pick<
    CommentOpportunity,
    "priorityScore" | "publishedAt" | "capturedAt" | "status" | "risk"
  >,
  referenceAt = opportunity.capturedAt,
) {
  const statusAdjustment = opportunity.status === "surging"
    ? 4
    : opportunity.status === "watch"
      ? -6
      : 0;
  const riskAdjustment = opportunity.risk.level === "medium" ? -6 : 0;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        opportunity.priorityScore * 0.7 +
          commentOpportunityFreshnessScore(opportunity, referenceAt) * 0.3 +
          statusAdjustment +
          riskAdjustment,
      ),
    ),
  );
}

export function rankCommentOpportunities(
  opportunities: readonly CommentOpportunity[],
  referenceAt?: string,
) {
  return [...opportunities].sort((left, right) => {
    const rightRankScore = commentOpportunityRankScore(right, referenceAt ?? right.capturedAt);
    const leftRankScore = commentOpportunityRankScore(left, referenceAt ?? left.capturedAt);
    if (rightRankScore !== leftRankScore) {
      return rightRankScore - leftRankScore;
    }
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }
    const rightPublishedAt = right.publishedAt === null
      ? Date.parse(right.capturedAt)
      : Date.parse(right.publishedAt);
    const leftPublishedAt = left.publishedAt === null
      ? Date.parse(left.capturedAt)
      : Date.parse(left.publishedAt);
    if (rightPublishedAt !== leftPublishedAt) {
      return rightPublishedAt - leftPublishedAt;
    }
    return left.title.localeCompare(right.title, "fr");
  });
}

function assertMetrics(
  value: unknown,
  context: string,
): asserts value is CommentOpportunityMetrics {
  if (!value || typeof value !== "object") {
    throw new Error(`Métriques de commentaire invalides : ${context}`);
  }
  const metrics = value as CommentOpportunityMetrics;
  if (METRIC_KEYS.some((key) => !isNullablePublicMetric(metrics[key]))) {
    throw new Error(`Métriques de commentaire invalides : ${context}`);
  }
}

export function assertCommentOpportunityFeed(
  value: unknown,
): CommentOpportunityFeed {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot Commentaires invalide.");
  }
  const feed = value as CommentOpportunityFeed;
  const capturedTimestamp = typeof feed.capturedAt === "string"
    ? Date.parse(feed.capturedAt)
    : Number.NaN;
  const nextRefreshTimestamp = typeof feed.nextRefreshAt === "string"
    ? Date.parse(feed.nextRefreshAt)
    : Number.NaN;
  if (
    feed.version !== 1 ||
    feed.cadenceHours !== COMMENT_OPPORTUNITY_REFRESH_CADENCE_HOURS ||
    !Number.isFinite(capturedTimestamp) ||
    !Number.isFinite(nextRefreshTimestamp) ||
    nextRefreshTimestamp <= capturedTimestamp ||
    nextRefreshTimestamp - capturedTimestamp >
      COMMENT_OPPORTUNITY_REFRESH_CADENCE_HOURS * HOUR_IN_MILLISECONDS ||
    !Array.isArray(feed.sourceChecks) ||
    !Array.isArray(feed.opportunities)
  ) {
    throw new Error("Snapshot Commentaires invalide.");
  }

  const sourceCheckIds = new Set<string>();
  const checkedPlatforms = new Set<CommentOpportunityPlatform>();
  for (const sourceCheck of feed.sourceChecks) {
    const checkedTimestamp = typeof sourceCheck?.checkedAt === "string"
      ? Date.parse(sourceCheck.checkedAt)
      : Number.NaN;
    if (
      !sourceCheck ||
      !isText(sourceCheck.id) ||
      sourceCheckIds.has(sourceCheck.id) ||
      !VALID_PLATFORMS.has(sourceCheck.platform) ||
      checkedPlatforms.has(sourceCheck.platform) ||
      !["success", "limited", "failed"].includes(sourceCheck.status) ||
      !Number.isFinite(checkedTimestamp) ||
      checkedTimestamp > capturedTimestamp ||
      !isText(sourceCheck.label)
    ) {
      throw new Error(`Contrôle de source Commentaires invalide : ${sourceCheck?.id ?? "inconnu"}`);
    }
    sourceCheckIds.add(sourceCheck.id);
    checkedPlatforms.add(sourceCheck.platform);
  }
  if (checkedPlatforms.size !== VALID_PLATFORMS.size) {
    throw new Error("Une source doit être contrôlée pour chaque plateforme Commentaires.");
  }

  const ids = new Set<string>();
  const nativePosts = new Set<string>();
  for (const opportunity of feed.opportunities) {
    if (!opportunity || typeof opportunity !== "object") {
      throw new Error("Opportunité de commentaire invalide.");
    }
    const publishedTimestamp = opportunity.publishedAt === null
      ? null
      : typeof opportunity.publishedAt === "string"
        ? Date.parse(opportunity.publishedAt)
        : Number.NaN;
    const opportunityCapturedTimestamp = typeof opportunity.capturedAt === "string"
      ? Date.parse(opportunity.capturedAt)
      : Number.NaN;
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(opportunity.id) ||
      ids.has(opportunity.id) ||
      !VALID_PLATFORMS.has(opportunity.platform) ||
      opportunity.mediaType !== "video" ||
      !isText(opportunity.author) ||
      !isText(opportunity.title) ||
      !isText(opportunity.caption) ||
      !isNativeCommentOpportunityUrl(opportunity.url, opportunity.platform) ||
      (opportunity.thumbnailUrl !== null && !isHttpsUrl(opportunity.thumbnailUrl)) ||
      (opportunity.durationSeconds !== null &&
        (typeof opportunity.durationSeconds !== "number" ||
          !Number.isFinite(opportunity.durationSeconds) ||
          opportunity.durationSeconds <= 0)) ||
      (publishedTimestamp !== null &&
        (!Number.isFinite(publishedTimestamp) || publishedTimestamp > capturedTimestamp)) ||
      !Number.isFinite(opportunityCapturedTimestamp) ||
      opportunityCapturedTimestamp > capturedTimestamp ||
      VALID_STATUSES.has(opportunity.status) === false ||
      !isScore(opportunity.lofiFitScore) ||
      !isScore(opportunity.commentabilityScore) ||
      !isScore(opportunity.priorityScore) ||
      opportunity.priorityScore !== commentOpportunityPriorityScore(opportunity) ||
      !isText(opportunity.whyNow) ||
      opportunity.whyNow.length > 220 ||
      !opportunity.risk ||
      !VALID_RISK_LEVELS.has(opportunity.risk.level) ||
      !isText(opportunity.risk.note)
    ) {
      throw new Error(`Opportunité de commentaire invalide : ${opportunity.id ?? "inconnue"}`);
    }
    ids.add(opportunity.id);
    const nativeIdentity = canonicalOpportunityIdentity(opportunity);
    if (nativePosts.has(nativeIdentity)) {
      throw new Error(`Post natif dupliqué : ${opportunity.url}`);
    }
    nativePosts.add(nativeIdentity);

    assertMetrics(opportunity.metrics, opportunity.id);
    if (!Array.isArray(opportunity.observations) || opportunity.observations.length === 0) {
      throw new Error(`Provenance métrique absente : ${opportunity.id}`);
    }
    let previousObservationTimestamp = Number.NEGATIVE_INFINITY;
    for (const observation of opportunity.observations) {
      const observationTimestamp = typeof observation?.capturedAt === "string"
        ? Date.parse(observation.capturedAt)
        : Number.NaN;
      assertMetrics(observation, opportunity.id);
      if (
        !Number.isFinite(observationTimestamp) ||
        observationTimestamp <= previousObservationTimestamp ||
        observationTimestamp > capturedTimestamp ||
        !isText(observation.sourceLabel) ||
        !isHttpsUrl(observation.sourceUrl) ||
        !VALID_EXACTNESS.has(observation.exactness) ||
        (observation.exactness === "unavailable" && hasAnyMetric(observation)) ||
        (observation.exactness !== "unavailable" && !hasAnyMetric(observation))
      ) {
        throw new Error(`Observation de commentaire invalide : ${opportunity.id}`);
      }
      previousObservationTimestamp = observationTimestamp;
    }
    const latestObservation = opportunity.observations.at(-1);
    if (
      !latestObservation ||
      latestObservation.capturedAt !== opportunity.capturedAt ||
      !metricsMatch(opportunity.metrics, latestObservation)
    ) {
      throw new Error(`Métriques sans provenance concordante : ${opportunity.id}`);
    }
    if (opportunity.status === "surging" &&
      !hasCommentOpportunityAccelerationEvidence(opportunity)) {
      throw new Error(`Accélération non prouvée : ${opportunity.id}`);
    }
    if (opportunity.status === "hot" && !hasAnyMetric(opportunity.metrics)) {
      throw new Error(`Statut hot sans signal public : ${opportunity.id}`);
    }

    if (!Array.isArray(opportunity.comments) || opportunity.comments.length !== 3) {
      throw new Error(`Trois commentaires requis : ${opportunity.id}`);
    }
    const tones = new Set<CommentOpportunityTone>();
    const commentTexts = new Set<string>();
    for (const comment of opportunity.comments) {
      const normalizedText = isText(comment?.text)
        ? normalizeComment(comment.text)
        : "";
      if (
        !comment ||
        !VALID_TONES.has(comment.tone) ||
        tones.has(comment.tone) ||
        !isText(comment.label) ||
        !normalizedText ||
        normalizedText.length > COMMENT_OPPORTUNITY_MAX_COMMENT_LENGTH ||
        commentTexts.has(normalizedText) ||
        isPromotionalComment(comment.text)
      ) {
        throw new Error(`Commentaire proposé invalide : ${opportunity.id}`);
      }
      tones.add(comment.tone);
      commentTexts.add(normalizedText);
    }
    if (tones.size !== VALID_TONES.size) {
      throw new Error(`Tons de commentaire incomplets : ${opportunity.id}`);
    }
  }

  for (const sourceCheck of feed.sourceChecks) {
    const platformCount = feed.opportunities.filter(
      (opportunity) => opportunity.platform === sourceCheck.platform,
    ).length;
    if (sourceCheck.status === "failed" && platformCount > 0) {
      throw new Error(`Source échouée mais opportunités publiées : ${sourceCheck.platform}`);
    }
    if (sourceCheck.status === "success" && platformCount === 0) {
      throw new Error(`Source réussie sans opportunité : ${sourceCheck.platform}`);
    }
  }
  return feed;
}
