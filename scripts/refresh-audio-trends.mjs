import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertAudioTrendFeed } from "../lib/audio-trends.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const feedPath = resolve(root, "data", "audio-trends", "feed.json");
const statusPath = resolve(root, "data", "audio-trends", "refresh-status.json");
const TRACKED_PLATFORMS = ["instagram", "tiktok"];
const PARIS_TIMEZONE = "Europe/Paris";
const COUNTER_LINK_WINDOW = 8_192;

export const AUDIO_REFRESH_CONCURRENCY = 6;
export const AUDIO_REFRESH_TIMEOUT_MS = 12_000;
export const AUDIO_REFRESH_MIN_PROVIDER_MATCHES = 2;
export const AUDIO_REFRESH_MIN_PROVIDER_COVERAGE = 0.7;
export const AUDIO_REFRESH_MIN_TOTAL_COVERAGE = 0.75;

export async function buildAudioTrendRefresh({
  feed,
  now = new Date().toISOString(),
  fetchImpl = fetch,
  concurrency = AUDIO_REFRESH_CONCURRENCY,
  timeoutMs = AUDIO_REFRESH_TIMEOUT_MS,
}) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Horodatage de refresh audio invalide.");
  const current = assertAudioTrendFeed(structuredClone(feed));
  const next = structuredClone(current);
  const jobs = next.trends.filter((trend) => TRACKED_PLATFORMS.includes(trend.platform));
  const checks = await mapWithConcurrency(jobs, concurrency, (trend) =>
    inspectAudioTrend(trend, { capturedAt: now, fetchImpl, timeoutMs })
  );

  const providerResults = TRACKED_PLATFORMS.map((platform) => {
    const platformChecks = checks.filter((check) => check.platform === platform);
    const checked = platformChecks.length;
    const matched = platformChecks.filter((check) => check.matched).length;
    const updated = platformChecks.filter((check) => check.updated).length;
    const requiredMatched = requiredProviderMatches(checked);
    const status = checked > 0 && matched >= requiredMatched ? "success" : "failed";
    const errors = platformChecks
      .filter((check) => check.error)
      .map((check) => `${check.id}: ${check.error}`);
    if (status === "failed" && checked > 0) {
      errors.push(`couverture insuffisante: ${matched}/${checked}, minimum ${requiredMatched}`);
    }
    return {
      platform,
      checked,
      matched,
      updated,
      requiredMatched,
      coverage: checked === 0 ? 0 : matched / checked,
      status,
      errors,
    };
  });

  providerResults.push({
    platform: "youtube",
    checked: 0,
    matched: 0,
    updated: 0,
    requiredMatched: 0,
    coverage: 0,
    status: "limited",
    errors: ["YouTube n'expose pas de compteur global d'utilisations audio comparable."],
  });

  const coverage = evaluateAudioRefreshCoverage(providerResults);
  const status = {
    version: 1,
    attemptedAt: now,
    status: coverage.publishable ? "success" : "failed",
    published: coverage.publishable,
    coverage,
    providers: providerResults,
  };

  if (!coverage.publishable) {
    const error = new Error(
      `Couverture audio insuffisante: ${coverage.totalMatched}/${coverage.totalChecked}, minimum ${coverage.requiredTotal}.`,
    );
    error.refreshStatus = status;
    throw error;
  }

  next.capturedAt = now;
  next.nextRefreshAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1_000).toISOString();
  next.sourceChecks = next.sourceChecks.map((sourceCheck) => {
    const result = providerResults.find((candidate) => candidate.platform === sourceCheck.platform);
    if (!result) return sourceCheck;
    return {
      ...sourceCheck,
      status: result.status,
      checkedAt: now,
    };
  });
  assertAudioTrendFeed(next);
  return { feed: next, status };
}

async function inspectAudioTrend(trend, { capturedAt, fetchImpl, timeoutMs }) {
  try {
    const expectedIdentity = nativeAudioIdentity(trend.audioUrl, trend.platform);
    if (!expectedIdentity) throw new Error("identite audio native absente");

    const response = await fetchImpl(trend.audioUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const finalUrl = response.url || trend.audioUrl;
    const finalIdentity = nativeAudioIdentity(finalUrl, trend.platform);
    if (!finalIdentity || finalIdentity !== expectedIdentity) {
      throw new Error("redirection vers une autre identite audio");
    }

    const html = await response.text();
    const parsed = parsePublicUsageCounter(html, trend.platform, {
      expectedAudioUrl: trend.audioUrl,
      responseUrl: finalUrl,
    });
    if (!parsed || parsed.audioId !== expectedIdentity) {
      throw new Error("compteur public non lie a cette identite audio");
    }

    const previousUses = [...trend.usageObservations]
      .reverse()
      .find((observation) => observation.uses !== null)?.uses ?? null;
    if (previousUses !== null && parsed.uses < previousUses) {
      throw new Error("compteur incoherent avec le dernier releve");
    }

    const lastCapturedAt = trend.usageObservations.at(-1)?.capturedAt;
    if (lastCapturedAt && sameParisDay(lastCapturedAt, capturedAt)) {
      return { id: trend.id, platform: trend.platform, matched: true, updated: false, error: null };
    }

    const sourceUrl = canonicalNativeAudioUrl(trend.audioUrl);
    trend.usageObservations.push({
      capturedAt,
      uses: parsed.uses,
      rank: null,
      rankWindow: null,
      sourceLabel: `${trend.platform === "tiktok" ? "TikTok" : "Instagram"} · compteur public${parsed.exactness === "platform-estimate" ? " abrege" : ""}`,
      sourceUrl,
      exactness: parsed.exactness,
    });
    trend.usageObservations = trend.usageObservations.slice(-30);
    return { id: trend.id, platform: trend.platform, matched: true, updated: true, error: null };
  } catch (error) {
    return {
      id: trend.id,
      platform: trend.platform,
      matched: false,
      updated: false,
      error: error instanceof Error ? error.message : "erreur inconnue",
    };
  }
}

export function nativeAudioIdentity(candidate, platform) {
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if (url.protocol !== "https:") return null;
    if (platform === "instagram") {
      if (!(host === "instagram.com" || host.endsWith(".instagram.com"))) return null;
      return path.match(/^\/reels\/audio\/([A-Za-z0-9_-]+)$/u)?.[1] ?? null;
    }
    if (platform === "tiktok") {
      if (!(host === "tiktok.com" || host.endsWith(".tiktok.com"))) return null;
      return path.match(/^\/music\/[^/]*?(\d{8,24})$/u)?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export function parsePublicUsageCounter(html, platform, {
  expectedAudioUrl,
  responseUrl = expectedAudioUrl,
} = {}) {
  const audioId = nativeAudioIdentity(expectedAudioUrl, platform);
  const responseAudioId = nativeAudioIdentity(responseUrl, platform);
  if (!audioId || !responseAudioId || responseAudioId !== audioId) return null;

  const normalized = String(html ?? "")
    .replaceAll("\\u00e9", "e")
    .replaceAll("\\u00e8", "e")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#x202f;", " ")
    .replaceAll("&#8239;", " ");
  const identityPositions = allIndexesOf(normalized, audioId);
  const candidates = [];

  const patterns = platform === "tiktok"
    ? [
        { kind: "structured", pattern: /"(?:videoCount|video_count)"\s*:\s*"?(\d{1,12})"?/giu },
        { kind: "text", pattern: /(\d+(?:[.,]\d+)?)\s*([KMB])?\s*(?:videos|video)/giu },
      ]
    : [
        { kind: "structured", pattern: /"(?:reelsCount|clipsCount|mediaCount|reels_count|clips_count|media_count)"\s*:\s*"?(\d{1,12})"?/giu },
        { kind: "text", pattern: /(\d+(?:[.,]\d+)?)\s*([KMB])?\s*(?:reels?|videos|video)/giu },
      ];

  for (const { kind, pattern } of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const uses = parseCompactNumber(match[1], match[2]?.toUpperCase() ?? "");
      if (!Number.isSafeInteger(uses) || uses < 1) continue;
      candidates.push({
        uses,
        exactness: match[2] ? "platform-estimate" : "exact",
        kind,
        index: match.index ?? 0,
      });
    }
  }

  if (candidates.length === 0) return null;
  let linked = candidates;
  if (identityPositions.length > 0) {
    linked = candidates.filter((candidate) =>
      minimumDistance(candidate.index, identityPositions) <= COUNTER_LINK_WINDOW
    );
  }
  if (linked.length === 0) return null;

  const structured = linked.filter((candidate) => candidate.kind === "structured");
  const preferred = structured.length > 0 ? structured : linked;
  const distinctValues = new Set(preferred.map((candidate) => candidate.uses));
  if (distinctValues.size !== 1) return null;

  const exactCandidate = preferred.find((candidate) => candidate.exactness === "exact");
  const chosen = exactCandidate ?? preferred[0];
  return { uses: chosen.uses, exactness: chosen.exactness, audioId };
}

export function requiredProviderMatches(checked) {
  if (!Number.isInteger(checked) || checked <= 0) return 0;
  return Math.max(
    AUDIO_REFRESH_MIN_PROVIDER_MATCHES,
    Math.ceil(checked * AUDIO_REFRESH_MIN_PROVIDER_COVERAGE),
  );
}

export function evaluateAudioRefreshCoverage(providerResults) {
  const tracked = providerResults.filter((result) =>
    TRACKED_PLATFORMS.includes(result.platform) && result.checked > 0
  );
  const totalChecked = tracked.reduce((total, result) => total + result.checked, 0);
  const totalMatched = tracked.reduce((total, result) => total + result.matched, 0);
  const requiredTotal = totalChecked === 0
    ? AUDIO_REFRESH_MIN_PROVIDER_MATCHES
    : Math.max(
        AUDIO_REFRESH_MIN_PROVIDER_MATCHES,
        Math.ceil(totalChecked * AUDIO_REFRESH_MIN_TOTAL_COVERAGE),
      );
  const providersPassed = tracked.length === TRACKED_PLATFORMS.length && tracked.every((result) =>
    result.matched >= requiredProviderMatches(result.checked)
  );
  return {
    totalChecked,
    totalMatched,
    requiredTotal,
    ratio: totalChecked === 0 ? 0 : totalMatched / totalChecked,
    providersPassed,
    publishable: providersPassed && totalMatched >= requiredTotal,
  };
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const requestedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const safeConcurrency = Math.max(1, Math.min(items.length || 1, requestedConcurrency));
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: safeConcurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function allIndexesOf(text, search) {
  const positions = [];
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const index = text.indexOf(search, fromIndex);
    if (index < 0) break;
    positions.push(index);
    fromIndex = index + search.length;
  }
  return positions;
}

function minimumDistance(index, anchors) {
  return anchors.reduce(
    (minimum, anchor) => Math.min(minimum, Math.abs(index - anchor)),
    Number.POSITIVE_INFINITY,
  );
}

function parseCompactNumber(raw, suffix) {
  const value = Number(String(raw).replace(",", "."));
  const multiplier = suffix === "B"
    ? 1_000_000_000
    : suffix === "M"
      ? 1_000_000
      : suffix === "K"
        ? 1_000
        : 1;
  return Math.round(value * multiplier);
}

function canonicalNativeAudioUrl(candidate) {
  const url = new URL(candidate);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function sameParisDay(left, right) {
  const formatter = new Intl.DateTimeFormat("fr-CA", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(left)) === formatter.format(new Date(right));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function main() {
  const attemptedAt = new Date().toISOString();
  const feed = JSON.parse(await readFile(feedPath, "utf8"));
  try {
    const result = await buildAudioTrendRefresh({ feed, now: attemptedAt });
    await Promise.all([
      writeJsonAtomic(feedPath, result.feed),
      writeJsonAtomic(statusPath, result.status),
    ]);
    console.log(
      `Audio refresh published: ${result.status.coverage.totalMatched}/${result.status.coverage.totalChecked} counters linked.`,
    );
  } catch (error) {
    const failedStatus = error?.refreshStatus ?? {
      version: 1,
      attemptedAt,
      status: "failed",
      published: false,
      coverage: {
        totalChecked: 0,
        totalMatched: 0,
        requiredTotal: AUDIO_REFRESH_MIN_PROVIDER_MATCHES,
        ratio: 0,
        providersPassed: false,
        publishable: false,
      },
      providers: [],
    };
    await writeJsonAtomic(statusPath, failedStatus);
    throw error;
  }
}

const executedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executedDirectly) await main();
