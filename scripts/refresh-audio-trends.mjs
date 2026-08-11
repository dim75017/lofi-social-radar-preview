import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertAudioTrendFeed,
  isOfficialAudioTrendThumbnailUrl,
  isInstagramSignedPlaybackUrl,
  isPublishableAudioTrendReferenceVideo,
} from "../lib/audio-trends.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const feedPath = resolve(root, "data", "audio-trends", "feed.json");
const statusPath = resolve(root, "data", "audio-trends", "refresh-status.json");
const TRACKED_PLATFORMS = ["instagram", "tiktok"];
const PARIS_TIMEZONE = "Europe/Paris";
const COUNTER_LINK_WINDOW = 8_192;
const INSTAGRAM_REEL_HTML_MAX_BYTES = 2_000_000;
const INSTAGRAM_PLAYBACK_PROBE_BYTES = 262_144;
const INSTAGRAM_PLAYBACK_MIN_VALIDITY_MS = 6 * 60 * 60 * 1_000;
const INSTAGRAM_PLAYBACK_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
const TIKTOK_OEMBED_MAX_BYTES = 256_000;
const TIKTOK_THUMBNAIL_PROBE_BYTES = 65_536;
const TIKTOK_THUMBNAIL_MAX_BYTES = 10_000_000;

export const AUDIO_REFRESH_CONCURRENCY = 6;
export const AUDIO_REFRESH_TIMEOUT_MS = 12_000;
export const AUDIO_REFRESH_MIN_PROVIDER_MATCHES = 2;
export const AUDIO_REFRESH_MIN_PROVIDER_COVERAGE = 0.7;
export const AUDIO_REFRESH_MIN_TOTAL_COVERAGE = 0.75;
export const AUDIO_REFRESH_MIN_DISTINCT_TRENDS = 50;

export function evaluateAudioRefreshInventory(feed) {
  const trends = Array.isArray(feed?.trends) ? feed.trends : [];
  const trendIds = new Set();
  const audioUrls = new Set();
  const referenceUrls = new Set();
  const unpublishableReferenceTrendIds = [];

  for (const [index, trend] of trends.entries()) {
    if (typeof trend?.id === "string" && trend.id.trim().length > 0) {
      trendIds.add(trend.id.trim());
    }
    const audioUrl = canonicalInventoryUrl(trend?.audioUrl);
    if (audioUrl) audioUrls.add(audioUrl);
    const referenceUrl = canonicalInventoryUrl(trend?.referenceVideo?.url);
    if (referenceUrl) referenceUrls.add(referenceUrl);
    if (!isPublishableAudioTrendReferenceVideo(trend?.referenceVideo)) {
      unpublishableReferenceTrendIds.push(
        typeof trend?.id === "string" && trend.id.trim().length > 0
          ? trend.id.trim()
          : `index-${index}`,
      );
    }
  }

  const inventory = {
    requiredDistinctTrends: AUDIO_REFRESH_MIN_DISTINCT_TRENDS,
    totalTrends: trends.length,
    distinctTrendIds: trendIds.size,
    distinctAudioUrls: audioUrls.size,
    distinctReferenceUrls: referenceUrls.size,
    publishableReferenceVideos: trends.length - unpublishableReferenceTrendIds.length,
    unpublishableReferenceTrendIds,
  };
  return {
    ...inventory,
    publishable: inventory.totalTrends >= AUDIO_REFRESH_MIN_DISTINCT_TRENDS &&
      inventory.distinctTrendIds >= AUDIO_REFRESH_MIN_DISTINCT_TRENDS &&
      inventory.distinctAudioUrls >= AUDIO_REFRESH_MIN_DISTINCT_TRENDS &&
      inventory.distinctReferenceUrls >= AUDIO_REFRESH_MIN_DISTINCT_TRENDS &&
      inventory.publishableReferenceVideos === inventory.totalTrends,
  };
}

export async function buildAudioTrendRefresh({
  feed,
  now = new Date().toISOString(),
  fetchImpl = fetch,
  concurrency = AUDIO_REFRESH_CONCURRENCY,
  timeoutMs = AUDIO_REFRESH_TIMEOUT_MS,
}) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Horodatage de refresh audio invalide.");
  const candidate = structuredClone(feed);
  const inventory = evaluateAudioRefreshInventory(candidate);
  if (!inventory.publishable) {
    const status = {
      version: 1,
      attemptedAt: now,
      status: "failed",
      published: false,
      inventory,
      coverage: emptyAudioRefreshCoverage(false),
      providers: [],
    };
    const error = new Error(
      `Inventaire Audio Trends insuffisant: ${inventory.distinctTrendIds} trends, ` +
      `${inventory.distinctAudioUrls} audios et ${inventory.distinctReferenceUrls} references distinctes; ` +
      `${inventory.publishableReferenceVideos}/${inventory.totalTrends} videos de reference publiables; ` +
      `minimum ${inventory.requiredDistinctTrends}.`,
    );
    error.refreshStatus = status;
    throw error;
  }
  const current = assertAudioTrendFeed(candidate);
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
    const thumbnailChecked = platform === "tiktok" ? checked : 0;
    const thumbnailMatched = platformChecks.filter((check) => check.thumbnailMatched).length;
    const thumbnailCoverage = thumbnailChecked === 0 ? 0 : thumbnailMatched / thumbnailChecked;
    const thumbnailComplete = thumbnailChecked > 0 && thumbnailMatched === thumbnailChecked;
    const requiredMatched = requiredProviderMatches(checked);
    const status = checked > 0 && matched >= requiredMatched ? "success" : "failed";
    const errors = platformChecks
      .filter((check) => check.error)
      .map((check) => `${check.id}: ${check.error}`);
    if (status === "failed" && checked > 0) {
      errors.push(`couverture insuffisante: ${matched}/${checked}, minimum ${requiredMatched}`);
    }
    if (platform === "tiktok" && !thumbnailComplete) {
      errors.push(`couverture miniatures insuffisante: ${thumbnailMatched}/${thumbnailChecked}, minimum ${thumbnailChecked}`);
    }
    return {
      platform,
      checked,
      matched,
      updated,
      requiredMatched,
      coverage: checked === 0 ? 0 : matched / checked,
      thumbnailChecked,
      thumbnailMatched,
      thumbnailCoverage,
      thumbnailComplete,
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
    thumbnailChecked: 0,
    thumbnailMatched: 0,
    thumbnailCoverage: 0,
    thumbnailComplete: false,
    status: "limited",
    errors: ["YouTube n'expose pas de compteur global d'utilisations audio comparable."],
  });

  const baseCoverage = evaluateAudioRefreshCoverage(providerResults);
  const instagramPlaybackChecks = checks.filter((check) => check.platform === "instagram");
  const instagramPlaybackMatched = instagramPlaybackChecks
    .filter((check) => check.playbackMatched).length;
  const instagramPlaybackComplete = instagramPlaybackChecks.length > 0 &&
    instagramPlaybackMatched === instagramPlaybackChecks.length;
  const tiktokThumbnailChecks = checks.filter((check) => check.platform === "tiktok");
  const tiktokThumbnailMatched = tiktokThumbnailChecks
    .filter((check) => check.thumbnailMatched).length;
  const tiktokThumbnailComplete = tiktokThumbnailChecks.length > 0 &&
    tiktokThumbnailMatched === tiktokThumbnailChecks.length;
  const successfulPublication = baseCoverage.publishable &&
    instagramPlaybackComplete &&
    tiktokThumbnailComplete;
  const degradedPublication = !baseCoverage.publishable &&
    instagramPlaybackComplete &&
    tiktokThumbnailComplete;
  const coverage = {
    ...baseCoverage,
    catalogPublishable: inventory.publishable,
    instagramPlaybackChecked: instagramPlaybackChecks.length,
    instagramPlaybackMatched,
    instagramPlaybackComplete,
    tiktokThumbnailChecked: tiktokThumbnailChecks.length,
    tiktokThumbnailMatched,
    tiktokThumbnailCoverage: tiktokThumbnailChecks.length === 0
      ? 0
      : tiktokThumbnailMatched / tiktokThumbnailChecks.length,
    tiktokThumbnailComplete,
    thumbnailPublishable: tiktokThumbnailComplete,
    counterPublishable: baseCoverage.publishable,
    publishable: inventory.publishable && (successfulPublication || degradedPublication),
  };
  const status = {
    version: 1,
    attemptedAt: now,
    status: successfulPublication
      ? "success"
      : degradedPublication
        ? "degraded"
        : "failed",
    published: coverage.publishable,
    inventory,
    coverage,
    providers: providerResults,
  };

  if (!coverage.publishable) {
    const reason = !tiktokThumbnailComplete
      ? `Couverture miniature TikTok insuffisante: ${tiktokThumbnailMatched}/${tiktokThumbnailChecks.length}.`
      : !instagramPlaybackComplete
        ? `Couverture playback Instagram insuffisante: ${instagramPlaybackMatched}/${instagramPlaybackChecks.length}.`
        : `Couverture audio insuffisante: ${coverage.totalMatched}/${coverage.totalChecked}, minimum ${coverage.requiredTotal}.`;
    const error = new Error(reason);
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
  let playbackMatched = false;
  let thumbnailMatched = false;
  const assetErrors = [];
  try {
    const expectedIdentity = nativeAudioIdentity(trend.audioUrl, trend.platform);
    if (!expectedIdentity) throw new Error("identite audio native absente");

    const playbackPromise = trend.platform === "instagram"
      ? collectInstagramSignedPlayback({
          referenceUrl: trend.referenceVideo.url,
          capturedAt,
          fetchImpl,
          timeoutMs,
        })
      : Promise.resolve(null);
    const thumbnailPromise = trend.platform === "tiktok"
      ? collectTikTokThumbnail({
          referenceUrl: trend.referenceVideo.url,
          fetchImpl,
          timeoutMs,
        })
      : Promise.resolve(null);
    const counterPromise = fetchImpl(trend.audioUrl, publicPageRequestOptions(timeoutMs));
    const [playbackResult, thumbnailResult, counterResult] = await Promise.allSettled([
      playbackPromise,
      thumbnailPromise,
      counterPromise,
    ]);
    if (playbackResult.status === "fulfilled" && playbackResult.value) {
      playbackMatched = true;
      trend.referenceVideo.playbackUrl = playbackResult.value.url;
      trend.referenceVideo.playbackCapturedAt = playbackResult.value.capturedAt;
      trend.referenceVideo.playbackExpiresAt = playbackResult.value.expiresAt;
    }
    if (thumbnailResult.status === "fulfilled" && thumbnailResult.value) {
      thumbnailMatched = true;
      trend.referenceVideo.thumbnailUrl = thumbnailResult.value.url;
    }
    if (playbackResult.status === "rejected") {
      assetErrors.push(playbackResult.reason instanceof Error
        ? playbackResult.reason.message
        : "playback Instagram indisponible");
    }
    if (thumbnailResult.status === "rejected") {
      assetErrors.push(thumbnailResult.reason instanceof Error
        ? thumbnailResult.reason.message
        : "miniature TikTok indisponible");
    }
    if (counterResult.status === "rejected") throw counterResult.reason;

    const playback = playbackResult.value;
    const thumbnail = thumbnailResult.value;
    const response = counterResult.value;
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
      return {
        id: trend.id,
        platform: trend.platform,
        matched: true,
        updated: Boolean(playback || thumbnail),
        playbackMatched,
        thumbnailMatched,
        error: assetErrors.length > 0 ? assetErrors.join("; ") : null,
      };
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
    return {
      id: trend.id,
      platform: trend.platform,
      matched: true,
      updated: true,
      playbackMatched,
      thumbnailMatched,
      error: assetErrors.length > 0 ? assetErrors.join("; ") : null,
    };
  } catch (error) {
    return {
      id: trend.id,
      platform: trend.platform,
      matched: false,
      updated: playbackMatched || thumbnailMatched,
      playbackMatched,
      thumbnailMatched,
      error: [
        ...assetErrors,
        error instanceof Error ? error.message : "erreur inconnue",
      ].filter((message, index, messages) => messages.indexOf(message) === index).join("; "),
    };
  }
}

export async function collectInstagramSignedPlayback({
  referenceUrl,
  capturedAt,
  fetchImpl = fetch,
  timeoutMs = AUDIO_REFRESH_TIMEOUT_MS,
}) {
  const expectedShortcode = nativeInstagramReelIdentity(referenceUrl);
  if (!expectedShortcode) throw new Error("reference Reel Instagram invalide");
  const response = await fetchImpl(referenceUrl, publicPageRequestOptions(timeoutMs));
  if (!response.ok) throw new Error(`Reel Instagram HTTP ${response.status}`);
  const finalUrl = response.url || referenceUrl;
  if (nativeInstagramReelIdentity(finalUrl) !== expectedShortcode) {
    throw new Error("redirection vers un autre Reel Instagram");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > INSTAGRAM_REEL_HTML_MAX_BYTES) {
    throw new Error("page Reel Instagram trop volumineuse");
  }
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > INSTAGRAM_REEL_HTML_MAX_BYTES) {
    throw new Error("page Reel Instagram trop volumineuse apres lecture");
  }

  const capturedTimestamp = Date.parse(capturedAt);
  if (!Number.isFinite(capturedTimestamp)) throw new Error("horodatage playback invalide");
  const candidates = extractInstagramSignedPlaybackCandidates(html)
    .map((url) => ({ url, expiresAt: instagramPlaybackExpiresAt(url) }))
    .filter(({ expiresAt }) => {
      if (!expiresAt) return false;
      const validity = Date.parse(expiresAt) - capturedTimestamp;
      return validity >= INSTAGRAM_PLAYBACK_MIN_VALIDITY_MS &&
        validity <= INSTAGRAM_PLAYBACK_MAX_VALIDITY_MS;
    });
  if (candidates.length === 0) {
    throw new Error("URL MP4 Instagram signee absente ou trop proche de son expiration");
  }

  const probeErrors = [];
  for (const candidate of candidates) {
    try {
      await verifyInstagramSignedPlayback(candidate.url, {
        expiresAt: candidate.expiresAt,
        fetchImpl,
        timeoutMs,
      });
      return {
        url: candidate.url,
        capturedAt,
        expiresAt: candidate.expiresAt,
      };
    } catch (error) {
      probeErrors.push(error instanceof Error ? error.message : "probe inconnue");
    }
  }
  throw new Error(`aucun MP4 Instagram lisible avec son: ${probeErrors.join("; ")}`);
}

export async function collectTikTokThumbnail({
  referenceUrl,
  fetchImpl = fetch,
  timeoutMs = AUDIO_REFRESH_TIMEOUT_MS,
}) {
  const expectedVideoId = nativeTikTokVideoIdentity(referenceUrl);
  if (!expectedVideoId) throw new Error("reference video TikTok invalide");

  const canonicalReferenceUrl = canonicalTikTokReferenceUrl(referenceUrl);
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", canonicalReferenceUrl);
  const response = await fetchImpl(endpoint.toString(), tiktokOEmbedRequestOptions(timeoutMs));
  if (!response.ok) throw new Error(`oEmbed TikTok HTTP ${response.status}`);
  if (response.url && !isExpectedTikTokOEmbedResponseUrl(response.url, expectedVideoId)) {
    throw new Error("redirection oEmbed TikTok invalide");
  }

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!Number.isFinite(Number(declaredLength)) || Number(declaredLength) > TIKTOK_OEMBED_MAX_BYTES)
  ) {
    throw new Error("reponse oEmbed TikTok trop volumineuse");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > TIKTOK_OEMBED_MAX_BYTES) {
    throw new Error("reponse oEmbed TikTok trop volumineuse apres lecture");
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("reponse oEmbed TikTok non JSON");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.type !== "video" ||
    payload.provider_name !== "TikTok" ||
    !isOfficialTikTokProviderUrl(payload.provider_url) ||
    !oEmbedHtmlMatchesTikTokVideo(payload.html, expectedVideoId) ||
    typeof payload.thumbnail_url !== "string" ||
    !isOfficialAudioTrendThumbnailUrl(payload.thumbnail_url, "tiktok")
  ) {
    throw new Error("oEmbed TikTok non attribuable a la video de reference");
  }

  const accessibleUrl = await verifyTikTokThumbnail(payload.thumbnail_url, {
    fetchImpl,
    timeoutMs,
  });
  return { url: accessibleUrl };
}

function canonicalTikTokReferenceUrl(candidate) {
  const url = new URL(candidate);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

function nativeTikTokVideoIdentity(candidate) {
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))
    ) {
      return null;
    }
    return url.pathname.replace(/\/+$/u, "")
      .match(/^\/@[^/]+\/video\/(\d{12,24})$/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isOfficialTikTokProviderUrl(candidate) {
  if (typeof candidate !== "string") return false;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (hostname === "tiktok.com" || hostname === "www.tiktok.com") &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

function isExpectedTikTokOEmbedResponseUrl(candidate, expectedVideoId) {
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !(hostname === "tiktok.com" || hostname === "www.tiktok.com") ||
      url.pathname.replace(/\/+$/u, "") !== "/oembed"
    ) {
      return false;
    }
    const embeddedReference = url.searchParams.get("url");
    return embeddedReference === null || nativeTikTokVideoIdentity(embeddedReference) === expectedVideoId;
  } catch {
    return false;
  }
}

function oEmbedHtmlMatchesTikTokVideo(html, expectedVideoId) {
  if (typeof html !== "string" || html.length === 0 || html.length > 100_000) return false;
  const identities = [
    ...[...html.matchAll(/data-video-id\s*=\s*["'](\d{12,24})["']/giu)]
      .map((match) => match[1]),
    ...[...html.matchAll(/https:\/\/(?:www\.)?tiktok\.com\/@[^/"'\s<>]+\/video\/(\d{12,24})/giu)]
      .map((match) => match[1]),
  ];
  return identities.length > 0 &&
    identities.includes(expectedVideoId) &&
    identities.every((identity) => identity === expectedVideoId);
}

async function verifyTikTokThumbnail(candidate, { fetchImpl, timeoutMs }) {
  if (!isOfficialAudioTrendThumbnailUrl(candidate, "tiktok")) {
    throw new Error("URL miniature TikTok invalide");
  }
  const response = await fetchImpl(candidate, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg",
      Range: `bytes=0-${TIKTOK_THUMBNAIL_PROBE_BYTES - 1}`,
      "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (![200, 206].includes(response.status)) {
    throw new Error(`miniature TikTok HTTP ${response.status}`);
  }
  const finalUrl = response.url || candidate;
  if (!isOfficialAudioTrendThumbnailUrl(finalUrl, "tiktok")) {
    throw new Error("redirection miniature TikTok invalide");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType?.startsWith("image/")) throw new Error("miniature TikTok non image");
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!Number.isFinite(Number(declaredLength)) ||
      Number(declaredLength) <= 0 ||
      Number(declaredLength) > TIKTOK_THUMBNAIL_MAX_BYTES)
  ) {
    throw new Error("taille miniature TikTok invalide");
  }
  const prefix = await readResponsePrefix(response, TIKTOK_THUMBNAIL_PROBE_BYTES);
  if (!isImagePrefix(prefix, contentType)) throw new Error("octets miniature TikTok invalides");
  return finalUrl;
}

function isImagePrefix(bytes, contentType) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 &&
      new TextDecoder("latin1").decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder("latin1").decode(bytes.slice(8, 12)) === "WEBP";
  }
  if (contentType === "image/avif") {
    const signature = new TextDecoder("latin1").decode(bytes.slice(0, 32));
    return bytes.length >= 12 && signature.includes("ftyp") && /(?:avif|avis)/u.test(signature);
  }
  return false;
}

function tiktokOEmbedRequestOptions(timeoutMs) {
  return {
    headers: {
      Accept: "application/json",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

export function extractInstagramSignedPlaybackCandidates(html) {
  let decoded = String(html ?? "");
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/\\u([0-9a-f]{4})/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\\//gu, "/")
      .replace(/&amp;/giu, "&")
      .replace(/&#0*38;|&#x0*26;/giu, "&");
  }
  const pattern = /https:\/\/scontent(?:-[a-z0-9-]+)?\.cdninstagram\.com\/[^"'<>\\\s]{1,8000}/giu;
  const candidates = [];
  for (const match of decoded.matchAll(pattern)) {
    const candidate = match[0];
    if (candidate.length > 8_192 || !isInstagramSignedPlaybackUrl(candidate)) continue;
    candidates.push(candidate);
  }
  return [...new Set(candidates)].sort((left, right) =>
    instagramPlaybackCandidateScore(right) - instagramPlaybackCandidateScore(left)
  );
}

export function instagramPlaybackExpiresAt(candidate) {
  if (!isInstagramSignedPlaybackUrl(candidate)) return null;
  const encodedExpiry = new URL(candidate).searchParams.get("oe");
  const expiryMilliseconds = Number.parseInt(encodedExpiry, 16) * 1_000;
  if (!Number.isSafeInteger(expiryMilliseconds)) return null;
  return new Date(expiryMilliseconds).toISOString();
}

async function verifyInstagramSignedPlayback(candidate, {
  expiresAt,
  fetchImpl,
  timeoutMs,
}) {
  if (!isInstagramSignedPlaybackUrl(candidate, expiresAt)) {
    throw new Error("URL CDN Instagram invalide");
  }
  const response = await fetchImpl(candidate, {
    headers: {
      Accept: "video/mp4",
      Origin: "https://dim75017.github.io",
      Range: `bytes=0-${INSTAGRAM_PLAYBACK_PROBE_BYTES - 1}`,
      "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (![200, 206].includes(response.status)) {
    throw new Error(`CDN Instagram HTTP ${response.status}`);
  }
  const finalUrl = response.url || candidate;
  if (!isInstagramSignedPlaybackUrl(finalUrl, expiresAt)) {
    throw new Error("redirection CDN Instagram invalide");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "video/mp4") throw new Error("contenu CDN non MP4");
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (allowOrigin !== "*" && allowOrigin !== "https://dim75017.github.io") {
    throw new Error("CDN Instagram non lisible depuis GitHub Pages");
  }
  const prefix = await readResponsePrefix(response, INSTAGRAM_PLAYBACK_PROBE_BYTES);
  const boxText = new TextDecoder("latin1").decode(prefix);
  const hasVideo = boxText.includes("vide") &&
    (boxText.includes("avc1") || boxText.includes("hvc1") || boxText.includes("hev1"));
  const hasAudio = boxText.includes("soun") && boxText.includes("mp4a");
  if (!hasVideo || !hasAudio) throw new Error("MP4 Instagram sans pistes audio et video confirmees");
}

function nativeInstagramReelIdentity(candidate) {
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !(hostname === "instagram.com" || hostname.endsWith(".instagram.com"))
    ) {
      return null;
    }
    return url.pathname.replace(/\/+$/u, "")
      .match(/^\/(?:reel|reels)\/([A-Za-z0-9_-]+)$/u)?.[1] ?? null;
  } catch {
    return null;
  }
}

function instagramPlaybackCandidateScore(candidate) {
  const url = new URL(candidate);
  return Number(url.searchParams.has("vs")) + Number(url.searchParams.has("_nc_vs"));
}

function publicPageRequestOptions(timeoutMs) {
  return {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; LofiSocialRadar/1.0; +https://github.com/dim75017/lofi-social-radar)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

async function readResponsePrefix(response, maximumBytes) {
  if (!response.body) {
    return new Uint8Array((await response.arrayBuffer()).slice(0, maximumBytes));
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
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

function canonicalInventoryUrl(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

function emptyAudioRefreshCoverage(catalogPublishable) {
  return {
    totalChecked: 0,
    totalMatched: 0,
    requiredTotal: AUDIO_REFRESH_MIN_PROVIDER_MATCHES,
    ratio: 0,
    providersPassed: false,
    catalogPublishable,
    instagramPlaybackChecked: 0,
    instagramPlaybackMatched: 0,
    instagramPlaybackComplete: false,
    tiktokThumbnailChecked: 0,
    tiktokThumbnailMatched: 0,
    tiktokThumbnailCoverage: 0,
    tiktokThumbnailComplete: false,
    thumbnailPublishable: false,
    counterPublishable: false,
    publishable: false,
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
      inventory: evaluateAudioRefreshInventory(feed),
      coverage: emptyAudioRefreshCoverage(false),
      providers: [],
    };
    await writeJsonAtomic(statusPath, failedStatus);
    throw error;
  }
}

const executedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executedDirectly) await main();
