export const AUDIENCE_PLATFORMS = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
] as const;

export const AUDIENCE_ENGAGEMENT_WINDOW_SIZE = 30 as const;
export const AUDIENCE_ENGAGEMENT_FORMULA =
  "mean(likes+comments)/followers*100" as const;

export type AudiencePlatform = (typeof AUDIENCE_PLATFORMS)[number];
export type AudiencePrecision =
  | "exact"
  | "platform-rounded"
  | "milestone";

export type AudienceObservation = {
  capturedAt: string;
  followers: number;
  precision: AudiencePrecision;
  sourceUrl: string;
  label: string;
};

export type AudienceEngagement = {
  calculatedAt: string;
  formula: typeof AUDIENCE_ENGAGEMENT_FORMULA;
  followers: number;
  followersObservedAt: string;
  followersPrecision: AudiencePrecision;
  sampleSize: number;
  averageInteractions: number;
  ratePercent: number;
  oldestPostAt: string;
  newestPostAt: string;
};

export type AudiencePlatformHistory = {
  profileUrl: string;
  observations: AudienceObservation[];
  engagement: AudienceEngagement | null;
};

export type AudienceHistory = {
  version: 1;
  generatedAt: string;
  engagementWindowSize: typeof AUDIENCE_ENGAGEMENT_WINDOW_SIZE;
  platforms: Record<AudiencePlatform, AudiencePlatformHistory>;
};

export type AudienceGrowth = {
  from: AudienceObservation;
  to: AudienceObservation;
  followersDelta: number;
  ratePercent: number;
  elapsedDays: number;
};

export type AudienceGrowthOptions = {
  days?: number;
  toleranceDays?: number;
};

export type AudiencePost = {
  platform?: unknown;
  format?: unknown;
  publishedAt?: unknown;
  published_at?: unknown;
  likes?: unknown;
  comments?: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const PRECISIONS = new Set<AudiencePrecision>([
  "exact",
  "platform-rounded",
  "milestone",
]);

/**
 * Validate the complete public audience snapshot. Missing or malformed values
 * are rejected rather than coerced to zero.
 */
export function assertAudienceHistory(value: unknown): AudienceHistory {
  const history = record(value, "Le snapshot audience doit être un objet.");
  if (history.version !== 1) {
    throw new Error("Le snapshot audience doit utiliser la version 1.");
  }
  assertTimestamp(history.generatedAt, "generatedAt");
  if (history.engagementWindowSize !== AUDIENCE_ENGAGEMENT_WINDOW_SIZE) {
    throw new Error(
      `engagementWindowSize doit valoir ${AUDIENCE_ENGAGEMENT_WINDOW_SIZE}.`,
    );
  }

  const platforms = record(
    history.platforms,
    "platforms doit contenir les quatre comptes officiels.",
  );
  for (const platform of AUDIENCE_PLATFORMS) {
    assertPlatformHistory(platform, platforms[platform]);
  }

  return value as AudienceHistory;
}

/** Return the latest real observation, without creating an intermediate point. */
export function latestAudienceObservation(
  platform: AudiencePlatformHistory,
): AudienceObservation | null {
  let latest: AudienceObservation | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const observation of platform.observations) {
    const time = Date.parse(observation.capturedAt);
    if (Number.isFinite(time) && time > latestTime) {
      latest = observation;
      latestTime = time;
    }
  }
  return latest;
}

/**
 * Compare two observed points only. With `days`, the baseline must exist close
 * to the requested date; no value is interpolated between milestones.
 */
export function audienceGrowth(
  platform: AudiencePlatformHistory,
  options: AudienceGrowthOptions = {},
): AudienceGrowth | null {
  const latest = latestAudienceObservation(platform);
  if (!latest) return null;
  const latestTime = Date.parse(latest.capturedAt);
  const older = platform.observations.filter(
    (observation) => Date.parse(observation.capturedAt) < latestTime,
  );
  if (older.length === 0) return null;

  let baseline: AudienceObservation | null = null;
  if (options.days === undefined) {
    baseline = older.reduce((earliest, observation) =>
      Date.parse(observation.capturedAt) < Date.parse(earliest.capturedAt)
        ? observation
        : earliest,
    );
  } else {
    if (!Number.isFinite(options.days) || options.days <= 0) {
      throw new Error("La fenêtre de croissance doit être un nombre de jours positif.");
    }
    const toleranceDays = options.toleranceDays ?? 1.5;
    if (!Number.isFinite(toleranceDays) || toleranceDays < 0) {
      throw new Error("La tolérance de croissance doit être positive ou nulle.");
    }
    const targetTime = latestTime - options.days * DAY_MS;
    const withinTolerance = older.filter(
      (observation) =>
        Math.abs(Date.parse(observation.capturedAt) - targetTime) <=
        toleranceDays * DAY_MS,
    );
    baseline = withinTolerance.reduce<AudienceObservation | null>(
      (closest, observation) => {
        if (!closest) return observation;
        return Math.abs(Date.parse(observation.capturedAt) - targetTime) <
          Math.abs(Date.parse(closest.capturedAt) - targetTime)
          ? observation
          : closest;
      },
      null,
    );
  }
  if (!baseline) return null;

  const followersDelta = latest.followers - baseline.followers;
  return {
    from: baseline,
    to: latest,
    followersDelta,
    ratePercent: round((followersDelta / baseline.followers) * 100),
    elapsedDays: round(
      (latestTime - Date.parse(baseline.capturedAt)) / DAY_MS,
    ),
  };
}

/**
 * Engagement public comparable across platforms: mean(likes + comments) over
 * the 30 latest eligible account posts, divided by the latest follower count.
 */
export function calculatePlatformEngagement(
  platform: AudiencePlatform,
  posts: readonly AudiencePost[],
  latestObservation: AudienceObservation | null,
  calculatedAt = new Date().toISOString(),
): AudienceEngagement | null {
  if (!latestObservation) return null;
  assertTimestamp(calculatedAt, "calculatedAt");

  const eligible = posts
    .flatMap((post, inputIndex) => {
      if (post.platform !== platform) return [];
      const format = typeof post.format === "string"
        ? post.format.trim().toLowerCase()
        : "";
      if (platform === "youtube" && format.includes("comment")) return [];
      const publishedAt = stringValue(post.publishedAt ?? post.published_at);
      const publishedTime = publishedAt ? Date.parse(publishedAt) : Number.NaN;
      const likes = publicCount(post.likes);
      const comments = publicCount(post.comments);
      if (!Number.isFinite(publishedTime) || likes === null || comments === null) {
        return [];
      }
      return [{
        inputIndex,
        publishedAt: new Date(publishedTime).toISOString(),
        publishedTime,
        interactions: likes + comments,
      }];
    })
    .sort((left, right) =>
      right.publishedTime - left.publishedTime ||
      left.inputIndex - right.inputIndex,
    )
    .slice(0, AUDIENCE_ENGAGEMENT_WINDOW_SIZE);

  if (eligible.length === 0) return null;
  const averageInteractions =
    eligible.reduce((sum, post) => sum + post.interactions, 0) /
    eligible.length;
  const newestPostAt = eligible[0].publishedAt;
  const oldestPostAt = eligible.at(-1)!.publishedAt;

  return {
    calculatedAt: new Date(calculatedAt).toISOString(),
    formula: AUDIENCE_ENGAGEMENT_FORMULA,
    followers: latestObservation.followers,
    followersObservedAt: latestObservation.capturedAt,
    followersPrecision: latestObservation.precision,
    sampleSize: eligible.length,
    averageInteractions: round(averageInteractions),
    ratePercent: round(
      (averageInteractions / latestObservation.followers) * 100,
    ),
    oldestPostAt,
    newestPostAt,
  };
}

/** Recompute every platform from the same immutable public post snapshot. */
export function recalculateAudienceEngagement(
  history: AudienceHistory,
  posts: readonly AudiencePost[],
  calculatedAt = new Date().toISOString(),
): AudienceHistory {
  // A newly appended follower observation makes the previously calculated
  // engagement intentionally stale. Validate the source observations first,
  // then replace all derived values in the same operation.
  assertAudienceHistory({
    ...history,
    platforms: Object.fromEntries(
      AUDIENCE_PLATFORMS.map((platform) => [
        platform,
        { ...history.platforms[platform], engagement: null },
      ]),
    ),
  });
  const canonicalCalculatedAt = new Date(calculatedAt).toISOString();
  const platforms = Object.fromEntries(
    AUDIENCE_PLATFORMS.map((platform) => {
      const current = history.platforms[platform];
      return [
        platform,
        {
          ...current,
          observations: current.observations.map((observation) => ({
            ...observation,
          })),
          engagement: calculatePlatformEngagement(
            platform,
            posts,
            latestAudienceObservation(current),
            canonicalCalculatedAt,
          ),
        },
      ];
    }),
  ) as Record<AudiencePlatform, AudiencePlatformHistory>;

  const next: AudienceHistory = {
    version: 1,
    generatedAt: canonicalCalculatedAt,
    engagementWindowSize: AUDIENCE_ENGAGEMENT_WINDOW_SIZE,
    platforms,
  };
  return assertAudienceHistory(next);
}

function assertPlatformHistory(
  platform: AudiencePlatform,
  value: unknown,
): void {
  const history = record(value, `${platform} doit être un objet.`);
  assertHttpsUrl(history.profileUrl, `${platform}.profileUrl`);
  if (!Array.isArray(history.observations) || history.observations.length === 0) {
    throw new Error(`${platform}.observations doit contenir au moins un relevé réel.`);
  }

  const capturedTimes = new Set<string>();
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const [index, candidate] of history.observations.entries()) {
    const observation = record(
      candidate,
      `${platform}.observations[${index}] doit être un objet.`,
    );
    const capturedAt = assertTimestamp(
      observation.capturedAt,
      `${platform}.observations[${index}].capturedAt`,
    );
    if (capturedTimes.has(capturedAt)) {
      throw new Error(`${platform} contient deux relevés au même instant.`);
    }
    capturedTimes.add(capturedAt);
    const capturedTime = Date.parse(capturedAt);
    if (capturedTime < previousTime) {
      throw new Error(`${platform}.observations doit être trié chronologiquement.`);
    }
    previousTime = capturedTime;
    if (
      typeof observation.followers !== "number" ||
      !Number.isInteger(observation.followers) ||
      observation.followers <= 0
    ) {
      throw new Error(`${platform}.followers doit être un entier strictement positif.`);
    }
    if (!PRECISIONS.has(observation.precision as AudiencePrecision)) {
      throw new Error(`${platform}.precision n’est pas reconnue.`);
    }
    assertHttpsUrl(
      observation.sourceUrl,
      `${platform}.observations[${index}].sourceUrl`,
    );
    if (typeof observation.label !== "string" || !observation.label.trim()) {
      throw new Error(`${platform}.observations[${index}].label est requis.`);
    }
  }

  if (history.engagement === null) return;
  const engagement = record(
    history.engagement,
    `${platform}.engagement doit être un objet ou null.`,
  );
  assertTimestamp(engagement.calculatedAt, `${platform}.engagement.calculatedAt`);
  if (engagement.formula !== AUDIENCE_ENGAGEMENT_FORMULA) {
    throw new Error(`${platform}.engagement.formula n’est pas reconnue.`);
  }
  const latest = latestAudienceObservation(history as AudiencePlatformHistory)!;
  if (
    engagement.followers !== latest.followers ||
    engagement.followersObservedAt !== latest.capturedAt ||
    engagement.followersPrecision !== latest.precision
  ) {
    throw new Error(`${platform}.engagement doit utiliser le dernier relevé réel.`);
  }
  if (
    typeof engagement.sampleSize !== "number" ||
    !Number.isInteger(engagement.sampleSize) ||
    engagement.sampleSize < 1 ||
    engagement.sampleSize > AUDIENCE_ENGAGEMENT_WINDOW_SIZE
  ) {
    throw new Error(`${platform}.engagement.sampleSize doit être compris entre 1 et 30.`);
  }
  assertNonnegativeNumber(
    engagement.averageInteractions,
    `${platform}.engagement.averageInteractions`,
  );
  assertNonnegativeNumber(
    engagement.ratePercent,
    `${platform}.engagement.ratePercent`,
  );
  const oldest = assertTimestamp(
    engagement.oldestPostAt,
    `${platform}.engagement.oldestPostAt`,
  );
  const newest = assertTimestamp(
    engagement.newestPostAt,
    `${platform}.engagement.newestPostAt`,
  );
  if (Date.parse(oldest) > Date.parse(newest)) {
    throw new Error(`${platform}.engagement a une fenêtre de posts inversée.`);
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} doit être une date ISO valide.`);
  }
  return value;
}

function assertHttpsUrl(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} doit être une URL HTTPS.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} doit être une URL HTTPS.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} doit être une URL HTTPS.`);
}

function assertNonnegativeNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} doit être un nombre positif ou nul.`);
  }
}

function publicCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
