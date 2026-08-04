import type { NormalizedPost, SocialPlatform } from "./social-scanner";

export type SocialMetric =
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "pollVotes";

export type ScoreConfidence = "high" | "medium" | "low" | "insufficient";

export type RankedPost = NormalizedPost & {
  performanceScore: number | null;
  confidence: ScoreConfidence;
  scoreExplanation: string;
  metricCoverage: SocialMetric[];
  cohortKey: string;
  rank: number | null;
  platformRank: number | null;
};

export type SocialInsight = {
  id: string;
  platform: SocialPlatform | "all";
  title: string;
  detail: string;
  confidence: ScoreConfidence;
};

export type PlatformAnalysis = {
  platform: SocialPlatform;
  postCount: number;
  availableMetrics: SocialMetric[];
  topExternalId: string | null;
  topScore: number | null;
};

export type SocialAnalysis = {
  generatedAt: string;
  postCount: number;
  platformCount: number;
  headline: string;
  coverage: PlatformAnalysis[];
  insights: SocialInsight[];
  caveats: string[];
};

const METRICS: SocialMetric[] = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "pollVotes",
];
const PLATFORM_SORT_ORDER: SocialPlatform[] = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
];
const METRIC_WEIGHTS: Record<SocialMetric, number> = {
  views: 0.45,
  likes: 0.25,
  comments: 0.15,
  shares: 0.1,
  saves: 0.05,
  pollVotes: 0.45,
};
const METRIC_LABELS: Record<SocialMetric, string> = {
  views: "vues cumulées",
  likes: "likes cumulés",
  comments: "commentaires cumulés",
  shares: "partages cumulés",
  saves: "sauvegardes cumulées",
  pollVotes: "votes du sondage cumulés",
};

type ScoreDraft = RankedPost;

export function rankPosts(
  posts: readonly NormalizedPost[],
  _now: Date | string | number = new Date(),
): RankedPost[] {
  void _now; // Kept for API compatibility; lifetime scoring is intentionally age-independent.
  const comparable = posts.map((post) => ({
    post,
    formatKey: normalizeFormat(post.format),
    values: comparableValues(post),
  }));
  const byPlatform = groupBy(comparable, (item) => item.post.platform);
  const drafts: ScoreDraft[] = [];

  for (const [platform, platformPosts] of byPlatform) {
    const byFormat = groupBy(platformPosts, (item) => item.formatKey);

    for (const item of platformPosts) {
      const cohort = byFormat.get(item.formatKey) ?? [item];
      const cohortKey = `${platform}:${item.formatKey}`;
      const metricCoverage = METRICS.filter(
        (metric) => item.values[metric] !== null,
      );
      const metricPercentiles: Partial<Record<SocialMetric, number>> = {};
      let weightedScore = 0;
      let availableWeight = 0;

      for (const metric of metricCoverage) {
        const value = item.values[metric];
        if (value === null) continue;
        const referenceValues = cohort
          .map((candidate) => candidate.values[metric])
          .filter((candidate): candidate is number => candidate !== null);
        if (referenceValues.length === 0) continue;
        const percentile = percentileRank(referenceValues, value);
        metricPercentiles[metric] = percentile;
        weightedScore += percentile * METRIC_WEIGHTS[metric];
        availableWeight += METRIC_WEIGHTS[metric];
      }

      const performanceScore =
        availableWeight > 0 ? Math.round(weightedScore / availableWeight) : null;
      const confidence = scoreConfidence(cohort.length, metricCoverage.length);

      drafts.push({
        ...item.post,
        performanceScore,
        confidence,
        scoreExplanation: explainScore(
          platform,
          cohort.length,
          metricCoverage,
          metricPercentiles,
          performanceScore,
        ),
        metricCoverage,
        cohortKey,
        rank: null,
        platformRank: null,
      });
    }
  }

  const sorted = drafts.sort(compareRankedPosts);
  let globalRank = 0;
  const platformRanks = new Map<SocialPlatform, number>();

  return sorted.map((post) => {
    if (post.performanceScore === null) return post;
    globalRank += 1;
    const platformRank = (platformRanks.get(post.platform) ?? 0) + 1;
    platformRanks.set(post.platform, platformRank);
    return { ...post, rank: globalRank, platformRank };
  });
}

export function buildSocialAnalysis(
  posts: readonly NormalizedPost[],
  now: Date | string | number = new Date(),
): SocialAnalysis {
  const referenceTime = validDate(now);
  const ranked = rankPosts(posts, referenceTime);
  const byPlatform = groupBy(ranked, (post) => post.platform);
  const coverage: PlatformAnalysis[] = [];
  const insights: SocialInsight[] = [];

  for (const platform of platformOrder(byPlatform.keys())) {
    const platformPosts = byPlatform.get(platform) ?? [];
    const top = platformPosts.find((post) => post.performanceScore !== null) ?? null;
    const availableMetrics = METRICS.filter((metric) =>
      platformPosts.some((post) => sourceMetric(post, metric) !== null),
    );
    coverage.push({
      platform,
      postCount: platformPosts.length,
      availableMetrics,
      topExternalId: top?.externalId ?? null,
      topScore: top?.performanceScore ?? null,
    });

    if (!top) {
      insights.push({
        id: `${platform}-insufficient`,
        platform,
        title: `${platformLabel(platform)} · données insuffisantes`,
        detail:
          "Aucune métrique publique exploitable n’est disponible pour classer ces contenus.",
        confidence: "insufficient",
      });
      continue;
    }

    if (platformPosts.length === 1) {
      insights.push({
        id: `${platform}-single-post`,
        platform,
        title: `${platformLabel(platform)} · un seul contenu observable`,
        detail:
          "Le contenu est visible, mais il n’existe pas encore de cohorte pour déclarer un gagnant.",
        confidence: "low",
      });
      continue;
    }

    insights.push({
      id: `${platform}-top-${top.externalId}`,
      platform,
      title: `${platformLabel(platform)} · ${displayTitle(top)}`,
      detail: top.scoreExplanation,
      confidence: top.confidence,
    });
  }

  const platformCount = byPlatform.size;
  const editorialInsights = buildEditorialInsights(ranked);
  return {
    generatedAt: referenceTime.toISOString(),
    postCount: posts.length,
    platformCount,
    headline:
      posts.length === 0
        ? "Aucun contenu public exploitable pour le moment."
        : `${posts.length} contenus publics comparés séparément sur ${platformCount} plateforme${platformCount > 1 ? "s" : ""}.`,
    coverage,
    insights: [...editorialInsights, ...insights],
    caveats: [
      "Les scores lifetime transforment les compteurs cumulés en percentiles dans chaque plateforme et chaque format ; ils ne comparent jamais directement les volumes bruts entre réseaux.",
      "Une métrique absente est exclue puis les poids restants sont renormalisés ; elle n’est jamais remplacée par zéro.",
      "Les enseignements sont descriptifs et probabilistes : ils ne démontrent pas une causalité créative.",
    ],
  };
}

function buildEditorialInsights(posts: readonly RankedPost[]): SocialInsight[] {
  const scored = posts.filter((post) => post.performanceScore !== null);
  if (scored.length === 0) return [];

  const insights: SocialInsight[] = [];
  const creativeGroups = new Map<string, RankedPost[]>();
  for (const post of scored) {
    const key = creativeKey(post);
    if (key.split(" ").length < 4) continue;
    const group = creativeGroups.get(key);
    if (group) group.push(post);
    else creativeGroups.set(key, [post]);
  }

  const crossPlatform = [...creativeGroups.entries()]
    .map(([key, group]) => ({
      key,
      group,
      platforms: new Set(group.map((post) => post.platform)),
      averageScore:
        group.reduce((sum, post) => sum + (post.performanceScore ?? 0), 0) /
        group.length,
    }))
    .filter((candidate) => candidate.platforms.size >= 2)
    .sort((left, right) =>
      right.platforms.size !== left.platforms.size
        ? right.platforms.size - left.platforms.size
        : right.averageScore - left.averageScore,
    )[0];

  if (crossPlatform) {
    const platformNames = [...crossPlatform.platforms].map(platformLabel);
    const pattern = editorialPattern(crossPlatform.group[0]);
    insights.push({
      id: `cross-platform-${crossPlatform.key}`,
      platform: "all",
      title: `Créatif cross-platform · ${displayTitle(crossPlatform.group[0])}`,
      detail: `La même accroche ressort sur ${joinFrench(platformNames)} avec un score moyen de ${Math.round(crossPlatform.averageScore)}/100. Le ressort « ${pattern} » mérite un nouveau test décliné nativement sur chaque réseau.`,
      confidence: crossPlatform.platforms.size >= 3 ? "medium" : "low",
    });
  }

  const top = scored[0];
  insights.push({
    id: `global-top-${top.platform}-${top.externalId}`,
    platform: top.platform,
    title: `Signal n°1 · ${displayTitle(top)}`,
    detail: `${platformLabel(top.platform)} le place en tête de sa cohorte avec ${top.performanceScore}/100. ${top.scoreExplanation} À utiliser comme benchmark de format et d’accroche, pas comme preuve causale.`,
    confidence: top.confidence,
  });

  const leaders = scored.slice(0, Math.min(8, scored.length));
  const patternCounts = new Map<string, number>();
  for (const post of leaders) {
    const pattern = editorialPattern(post);
    patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
  }
  const dominant = [...patternCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  })[0];

  if (leaders.length >= 3 && dominant && dominant[1] >= 2) {
    insights.push({
      id: `dominant-pattern-${dominant[0]}`,
      platform: "all",
      title: `Pattern dominant · ${dominant[0]}`,
      detail: `${dominant[1]} des ${leaders.length} contenus les mieux classés utilisent ce ressort. ${patternAction(dominant[0])}`,
      confidence: dominant[1] >= 3 ? "medium" : "low",
    });
  }

  return insights;
}

function creativeKey(post: NormalizedPost): string {
  const value = post.title?.trim() || post.text?.trim() || "";
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/#[\w-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
}

function editorialPattern(post: NormalizedPost): string {
  const value = `${post.title ?? ""} ${post.text ?? ""}`.toLowerCase();
  if (/radio|beats|music|mix|sleep|study|lofi/.test(value)) {
    return "Musique & usage";
  }
  if (/fortnite|game|album|release|merch|listen/.test(value)) {
    return "Activation";
  }
  if (/pocky|maya|girl|character|lore/.test(value)) {
    return "Personnage & lore";
  }
  if (/tell me|comment|\byou\b|\byour\b|\?/.test(value)) {
    return "Conversation";
  }
  return "Relatable & humour";
}

function patternAction(pattern: string): string {
  if (pattern === "Musique & usage") {
    return "La promesse d’usage est immédiatement lisible : contexte, humeur et bénéfice avant le titre du morceau.";
  }
  if (pattern === "Activation") {
    return "L’urgence de sortie ou d’événement semble porter le signal ; tester une accroche plus courte avec une action unique.";
  }
  if (pattern === "Personnage & lore") {
    return "La reconnaissance des personnages et la continuité narrative semblent aider ; privilégier les micro-épisodes sérialisables.";
  }
  if (pattern === "Conversation") {
    return "L’adresse directe réduit la distance avec la communauté ; tester une question simple dès la première ligne.";
  }
  return "Le signal vient d’une situation immédiatement reconnaissable et d’une chute courte ; tester trois variantes d’accroche sur le même noyau créatif.";
}

function joinFrench(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

function comparableValues(
  post: NormalizedPost,
): Record<SocialMetric, number | null> {
  return {
    views: safeMetric(post.views),
    likes: safeMetric(post.likes),
    comments: safeMetric(post.comments),
    shares: safeMetric(post.shares),
    saves: safeMetric(post.saves),
    pollVotes: sourceMetric(post, "pollVotes"),
  };
}

function sourceMetric(post: NormalizedPost, metric: SocialMetric): number | null {
  if (metric !== "pollVotes") return safeMetric(post[metric]);
  const raw = post.raw;
  if (!raw) return null;
  return safeMetric(
    typeof raw.pollVotes === "number"
      ? raw.pollVotes
      : typeof raw.pollTotalVotes === "number"
        ? raw.pollTotalVotes
        : null,
  );
}

function percentileRank(values: readonly number[], value: number): number {
  if (values.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const candidate of values) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }
  return Math.round(
    ((below + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100,
  );
}

function scoreConfidence(
  cohortSize: number,
  metricCount: number,
): ScoreConfidence {
  if (metricCount === 0) return "insufficient";
  if (cohortSize >= 8 && metricCount >= 3) return "high";
  if (cohortSize >= 4 && metricCount >= 2) return "medium";
  return "low";
}

function explainScore(
  platform: SocialPlatform,
  cohortSize: number,
  metricCoverage: SocialMetric[],
  metricPercentiles: Partial<Record<SocialMetric, number>>,
  score: number | null,
): string {
  if (score === null) {
    return `Aucune métrique publique comparable sur ${platformLabel(platform)}. Aucun score n’est calculé.`;
  }

  const strongest = metricCoverage
    .map((metric) => ({ metric, percentile: metricPercentiles[metric] ?? 50 }))
    .sort((left, right) =>
      right.percentile !== left.percentile
        ? right.percentile - left.percentile
        : METRICS.indexOf(left.metric) - METRICS.indexOf(right.metric),
    )
    .slice(0, 2)
    .map(
      ({ metric, percentile }) =>
        `${METRIC_LABELS[metric]} au ${percentile}e percentile`,
    );
  const signalLabel = metricCoverage.length > 1 ? "signaux" : "signal";
  const coverage = `${metricCoverage.length} ${signalLabel} public${metricCoverage.length > 1 ? "s" : ""} comparable${metricCoverage.length > 1 ? "s" : ""}`;
  return `Score lifetime ${score}/100 dans une cohorte ${platformLabel(platform)} de ${cohortSize} contenu${cohortSize > 1 ? "s" : ""} du même format · ${strongest.join(" · ")} · ${coverage}. Aucun bonus de récence. Lecture descriptive, pas causale.`;
}

function compareRankedPosts(left: ScoreDraft, right: ScoreDraft): number {
  if (left.performanceScore === null && right.performanceScore !== null) return 1;
  if (left.performanceScore !== null && right.performanceScore === null) return -1;
  if (left.performanceScore !== right.performanceScore) {
    return (right.performanceScore ?? -1) - (left.performanceScore ?? -1);
  }
  const confidenceDifference =
    confidenceOrder(right.confidence) - confidenceOrder(left.confidence);
  if (confidenceDifference !== 0) return confidenceDifference;
  if (left.cohortKey === right.cohortKey) {
    for (const metric of METRICS) {
      const metricDifference =
        (sourceMetric(right, metric) ?? -1) -
        (sourceMetric(left, metric) ?? -1);
      if (metricDifference !== 0) return metricDifference;
    }
  }
  const platformDifference =
    PLATFORM_SORT_ORDER.indexOf(left.platform) -
    PLATFORM_SORT_ORDER.indexOf(right.platform);
  if (platformDifference !== 0) return platformDifference;
  const cohortDifference = left.cohortKey.localeCompare(right.cohortKey);
  if (cohortDifference !== 0) return cohortDifference;
  return `${left.platform}:${left.externalId}`.localeCompare(
    `${right.platform}:${right.externalId}`,
  );
}

function validDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function safeMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeFormat(value: string | null): string {
  const format = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return format || "unknown";
}

function groupBy<T, K>(
  values: readonly T[],
  keyFor: (value: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

function platformOrder(values: IterableIterator<SocialPlatform>): SocialPlatform[] {
  const present = new Set(values);
  return PLATFORM_SORT_ORDER.filter((platform) => present.has(platform));
}

function platformLabel(platform: SocialPlatform): string {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  return "X";
}

function displayTitle(post: NormalizedPost): string {
  const title = post.title?.trim() || post.text?.trim() || "";
  return title ? (title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title) : post.externalId;
}

function confidenceOrder(value: ScoreConfidence): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}
