import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertPublishableSocialTrendFeed,
  assertSocialTrendFeed,
  isActionableSocialTrend,
  MIN_PUBLISHABLE_ACTIONABLE_TRENDS,
} from "../lib/social-trends.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const feedPath = resolve(root, "data", "trends", "feed.json");
const watchlistsPath = resolve(root, "data", "trends", "watchlists.json");
const statusPath = resolve(root, "data", "trends", "refresh-status.json");
const REQUEST_TIMEOUT_MS = 20_000;
const NATIVE_POST_TIMEOUT_MS = 12_000;
const NATIVE_POST_CONCURRENCY = 8;
const PARIS_TIMEZONE = "Europe/Paris";

export function nativeTrendVerificationRequest(post) {
  const url = new URL(post.url);
  if (post.platform === "tiktok") {
    const id = url.pathname.match(/\/video\/(\d{12,24})/iu)?.[1];
    if (!id) throw new Error("identifiant TikTok absent");
    return {
      url: `https://www.tiktok.com/oembed?url=${encodeURIComponent(post.url)}`,
      marker: id,
    };
  }
  if (post.platform === "youtube") {
    const id = url.pathname.match(/\/(?:shorts|watch)\/([A-Za-z0-9_-]{11})/iu)?.[1]
      ?? url.searchParams.get("v");
    if (!id) throw new Error("identifiant YouTube absent");
    return {
      url: `https://www.youtube.com/oembed?url=${encodeURIComponent(post.url)}&format=json`,
      marker: id,
    };
  }
  if (post.platform === "x") {
    const id = url.pathname.match(/\/status\/(\d+)/iu)?.[1];
    if (!id) throw new Error("identifiant X absent");
    return {
      url: `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(post.url)}`,
      marker: id,
    };
  }
  const shortcode = url.pathname.match(/\/(?:p|reel|reels)\/([^/]+)/iu)?.[1];
  if (!shortcode) throw new Error("identifiant Instagram absent");
  return { url: post.url, marker: shortcode };
}

export async function verifyNativeTrendPost(post, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = nativeTrendVerificationRequest(post);
  const response = await fetchImpl(request.url, {
    headers: {
      Accept: "text/html,application/json,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(NATIVE_POST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (!body.includes(request.marker)) {
    throw new Error("identité du post absente de la réponse");
  }
  return true;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function reverifyTrendReuseEvidence(trends, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const jobs = trends.flatMap((trend) =>
    (trend.reuseEvidence?.posts ?? []).map((post) => ({ trend, post })),
  );
  const checks = await mapWithConcurrency(
    jobs,
    options.concurrency ?? NATIVE_POST_CONCURRENCY,
    async ({ trend, post }) => {
      try {
        await verifyNativeTrendPost(post, { fetchImpl });
        return { trendId: trend.id, url: post.url, ok: true };
      } catch (error) {
        return {
          trendId: trend.id,
          url: post.url,
          ok: false,
          error: error instanceof Error ? error.message : "échec inconnu",
        };
      }
    },
  );
  const checksByTrend = Map.groupBy(checks, (check) => check.trendId);
  let reverified = 0;
  const failures = [];
  for (const trend of trends) {
    const trendChecks = checksByTrend.get(trend.id) ?? [];
    if (
      !trend.reuseEvidence ||
      trendChecks.length !== trend.reuseEvidence.posts.length ||
      trendChecks.some((check) => !check.ok)
    ) {
      failures.push(...trendChecks.filter((check) => !check.ok));
      continue;
    }
    trend.reuseEvidence.verifiedAt = now;
    for (const post of trend.reuseEvidence.posts) post.capturedAt = now;
    trend.lastVerifiedAt = now;
    reverified += 1;
  }
  return { reverified, checkedPosts: checks.length, failures };
}

export function normalizeSourceText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function localDateKey(value, timeZone = PARIS_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function trendSearchTerms(trend) {
  const title = trend.title.split("·")[0]?.trim() ?? trend.title;
  return [...new Set([title, ...(trend.keywords ?? [])]
    .map(normalizeSourceText)
    .filter((term) => term.length >= 5))];
}

export function countMatchedSignals(sourceText, trends) {
  const normalized = normalizeSourceText(sourceText);
  return trends.reduce((count, trend) => {
    const matched = trendSearchTerms(trend).some((term) => normalized.includes(term));
    return count + (matched ? 1 : 0);
  }, 0);
}

export async function checkTrendSource(source, trends, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = options.now ?? new Date().toISOString();
  try {
    const xBearerToken = options.xBearerToken ?? process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN;
    if (source.kind === "x-api" && !xBearerToken) {
      throw new Error("X_BEARER_TOKEN absent");
    }
    const response = await fetchImpl(source.url, {
      headers: {
        Accept: source.kind === "x-api" ? "application/json" : "text/html,application/xhtml+xml",
        ...(source.kind === "x-api" ? { Authorization: `Bearer ${xBearerToken}` } : {}),
        "User-Agent": "LofiSocialRadar/1.0 (+https://github.com/dim75017/lofi-social-radar)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (source.kind === "x-api") {
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data : [];
      const trendNames = items
        .map((item) => typeof item?.trend_name === "string" ? item.trend_name : "")
        .filter(Boolean);
      if (!trendNames.length) throw new Error("aucune tendance X parsée");
      const normalizedNames = normalizeSourceText(trendNames.join(" "));
      return {
        id: source.id,
        label: source.label,
        platform: source.platform,
        status: "success",
        checkedAt,
        candidatesMatched: countMatchedSignals(normalizedNames, trends),
        signature: createHash("sha256").update(normalizedNames).digest("hex").slice(0, 16),
      };
    }
    const body = await response.text();
    const normalized = normalizeSourceText(body);
    const markers = source.requiredMarkers.map(normalizeSourceText);
    if (!markers.every((marker) => normalized.includes(marker))) {
      throw new Error("structure reconnue absente");
    }
    return {
      id: source.id,
      label: source.label,
      platform: source.platform,
      status: "success",
      checkedAt,
      candidatesMatched: countMatchedSignals(body, trends),
      signature: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
    };
  } catch (error) {
    return {
      id: source.id,
      label: source.label,
      platform: source.platform,
      status: "failed",
      checkedAt,
      candidatesMatched: 0,
      error: error instanceof Error ? error.message : "échec inconnu",
    };
  }
}

export async function buildDailyTrendRefresh({
  feed,
  watchlists,
  now = new Date().toISOString(),
  fetchImpl = fetch,
  force = false,
  xBearerToken,
}) {
  const current = assertSocialTrendFeed(structuredClone(feed));
  if (!force && localDateKey(current.refresh.lastSuccessfulAt) === localDateKey(now)) {
    return { skipped: true, feed: current, status: current.refresh };
  }

  const actionable = current.trends.filter(isActionableSocialTrend);
  const checks = await Promise.all(
    watchlists.sources.map((source) =>
      checkTrendSource(source, actionable, { fetchImpl, now, xBearerToken }),
    ),
  );
  const successfulChecks = checks.filter((check) => check.status === "success");
  const checkedSources = successfulChecks.length;
  const matchedSignals = successfulChecks.reduce(
    (total, check) => total + check.candidatesMatched,
    0,
  );
  const lofiGirl = actionable.filter((trend) => trend.character === "lofi-girl").length;
  const lofiBoy = actionable.filter((trend) => trend.character === "lofi-boy").length;
  const baseRefresh = {
    cadenceHours: 24,
    lastAttemptAt: now,
    lastSuccessfulAt: current.refresh.lastSuccessfulAt,
    nextScheduledAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1_000).toISOString(),
    status: "degraded",
    runId: process.env.GITHUB_RUN_ID ?? `local-${localDateKey(now)}`,
    runUrl: process.env.GITHUB_RUN_URL ?? null,
    sourceChecks: checks.map((check) => ({
      id: check.id,
      label: check.label,
      platform: check.platform,
      status: check.status,
      checkedAt: check.checkedAt,
      candidatesMatched: check.candidatesMatched,
    })),
    counts: {
      checkedSources,
      matchedSignals,
      actionable: actionable.length,
      lofiGirl,
      lofiBoy,
    },
  };

  if (checkedSources < watchlists.minimumParsedSources) {
    const error = new Error(
      `Seulement ${checkedSources}/${watchlists.sources.length} sources Trends ont été parsées; minimum ${watchlists.minimumParsedSources}.`,
    );
    error.refreshStatus = baseRefresh;
    throw error;
  }

  const reuseVerification = await reverifyTrendReuseEvidence(actionable, {
    now,
    fetchImpl,
  });
  if (reuseVerification.reverified < MIN_PUBLISHABLE_ACTIONABLE_TRENDS) {
    const error = new Error(
      `Seulement ${reuseVerification.reverified}/${actionable.length} trends ont conservé trois reprises natives vérifiables; minimum ${MIN_PUBLISHABLE_ACTIONABLE_TRENDS}.`,
    );
    error.refreshStatus = baseRefresh;
    throw error;
  }

  const refreshedFeed = {
    ...current,
    capturedAt: now,
    refresh: {
      ...baseRefresh,
      lastSuccessfulAt: now,
      status: "success",
    },
  };
  assertSocialTrendFeed(refreshedFeed);
  assertPublishableSocialTrendFeed(refreshedFeed, { now });
  return { skipped: false, feed: refreshedFeed, status: refreshedFeed.refresh };
}

async function writeJsonAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}

async function main() {
  const attemptedAt = process.env.TREND_REFRESH_NOW ?? new Date().toISOString();
  const force = process.env.FORCE_TREND_REFRESH === "1";
  const [feed, watchlists] = await Promise.all([
    readFile(feedPath, "utf8").then(JSON.parse),
    readFile(watchlistsPath, "utf8").then(JSON.parse),
  ]);

  try {
    const result = await buildDailyTrendRefresh({ feed, watchlists, now: attemptedAt, force });
    if (result.skipped) {
      console.log(`Le feed Trends est déjà à jour pour ${localDateKey(attemptedAt)}.`);
      return;
    }
    await Promise.all([
      writeJsonAtomic(feedPath, result.feed),
      writeJsonAtomic(statusPath, {
        version: 1,
        ...result.status,
        message: "Rafraîchissement quotidien publié après validation complète.",
      }),
    ]);
    console.log(
      `Feed publié: ${result.status.counts.actionable} trends, ${result.status.counts.lofiGirl} Lofi Girl, ${result.status.counts.checkedSources} sources parsées.`,
    );
  } catch (error) {
    const status = error?.refreshStatus ?? {
      cadenceHours: 24,
      lastAttemptAt: attemptedAt,
      lastSuccessfulAt: feed?.refresh?.lastSuccessfulAt ?? feed?.capturedAt ?? attemptedAt,
      nextScheduledAt: new Date(Date.parse(attemptedAt) + 12 * 60 * 60 * 1_000).toISOString(),
      status: "degraded",
      runId: process.env.GITHUB_RUN_ID ?? `local-${localDateKey(attemptedAt)}`,
      runUrl: process.env.GITHUB_RUN_URL ?? null,
      sourceChecks: [],
      counts: {
        checkedSources: 0,
        matchedSignals: 0,
        actionable: 0,
        lofiGirl: 0,
        lofiBoy: 0,
      },
    };
    await writeJsonAtomic(statusPath, {
      version: 1,
      ...status,
      message: error instanceof Error ? error.message : "Rafraîchissement Trends impossible.",
    });
    throw error;
  }
}

const executedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executedDirectly) {
  await main();
}
