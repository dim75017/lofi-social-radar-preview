import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAudioTrendRefresh,
  collectInstagramSignedPlayback,
  collectTikTokThumbnail,
  evaluateAudioRefreshCoverage,
  extractInstagramSignedPlaybackCandidates,
  instagramPlaybackExpiresAt,
  mapWithConcurrency,
  nativeAudioIdentity,
  parsePublicUsageCounter,
  requiredProviderMatches,
} from "../scripts/refresh-audio-trends.mjs";

const feed = JSON.parse(
  await readFile(new URL("../data/audio-trends/feed.json", import.meta.url), "utf8"),
);

function counterHtml(trend, uses) {
  const audioId = nativeAudioIdentity(trend.audioUrl, trend.platform);
  assert.ok(audioId);
  const counterKey = trend.platform === "tiktok" ? "videoCount" : "mediaCount";
  return `<script type="application/json">{"audioId":"${audioId}","${counterKey}":${uses}}</script>`;
}

function latestUses(trend) {
  return [...trend.usageObservations]
    .reverse()
    .find((observation) => observation.uses !== null)?.uses ?? 1_000;
}

function signedPlaybackUrl(capturedAt, suffix = "primary") {
  const expiresAt = Date.parse(capturedAt) + 36 * 60 * 60 * 1_000;
  const encodedExpiry = Math.floor(expiresAt / 1_000).toString(16).toUpperCase();
  return `https://scontent-cdg4-1.cdninstagram.com/o1/v/t2/f2/m86/${suffix}.mp4?_nc_ht=scontent-cdg4-1.cdninstagram.com&oh=0123456789abcdef0123456789abcdef&oe=${encodedExpiry}&vs=1&_nc_vs=1`;
}

function signedPlaybackHtml(capturedAt) {
  const escaped = signedPlaybackUrl(capturedAt)
    .replaceAll("&", "\\u0026")
    .replaceAll("/", "\\/");
  return `<script>{"video_dash_manifest":"${escaped}"}</script>`;
}

function playbackProbeResponse() {
  return new Response("ftyp moov trak vide avc1 trak soun mp4a", {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "access-control-allow-origin": "*",
      "content-range": "bytes 0-40/1000",
    },
  });
}

function tiktokVideoId(trendOrUrl) {
  const url = typeof trendOrUrl === "string" ? trendOrUrl : trendOrUrl.referenceVideo.url;
  const identity = new URL(url).pathname.match(/\/video\/(\d{12,24})\/?$/u)?.[1];
  assert.ok(identity);
  return identity;
}

function tiktokThumbnailUrl(trendOrUrl) {
  return `https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/${tiktokVideoId(trendOrUrl)}.jpeg`;
}

function tiktokOEmbedPayload(trend, overrides = {}) {
  const videoId = tiktokVideoId(trend);
  return {
    version: "1.0",
    type: "video",
    provider_name: "TikTok",
    provider_url: "https://www.tiktok.com/",
    html: `<blockquote class="tiktok-embed" cite="${trend.referenceVideo.url}" data-video-id="${videoId}"></blockquote>`,
    thumbnail_url: tiktokThumbnailUrl(trend),
    thumbnail_width: 720,
    thumbnail_height: 1280,
    ...overrides,
  };
}

function tiktokTrendFromOEmbedRequest(url) {
  const candidate = new URL(url);
  if (candidate.hostname !== "www.tiktok.com" || candidate.pathname !== "/oembed") return null;
  const referenceUrl = candidate.searchParams.get("url");
  return feed.trends.find((trend) =>
    trend.platform === "tiktok" && trend.referenceVideo.url === referenceUrl
  ) ?? null;
}

function thumbnailProbeResponse({ contentType = "image/jpeg", status = 206 } = {}) {
  const bytes = contentType === "image/jpeg"
    ? Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    : new TextEncoder().encode("not an image");
  return new Response(bytes, {
    status,
    headers: {
      "content-type": contentType,
      "content-range": "bytes 0-9/1000",
    },
  });
}

test("native audio counters are tied to the requested platform identity", () => {
  const instagramUrl = "https://www.instagram.com/reels/audio/123456789012345/";
  const html = '<script>{"audioId":"123456789012345","mediaCount":1200}</script>';
  assert.deepEqual(
    parsePublicUsageCounter(html, "instagram", {
      expectedAudioUrl: instagramUrl,
      responseUrl: instagramUrl,
    }),
    { uses: 1_200, exactness: "exact", audioId: "123456789012345" },
  );
  assert.equal(
    parsePublicUsageCounter(html, "instagram", {
      expectedAudioUrl: instagramUrl,
      responseUrl: "https://www.instagram.com/reels/audio/999999999999999/",
    }),
    null,
  );
  assert.equal(
    parsePublicUsageCounter(
      `${html}<script>{"audioId":"123456789012345","mediaCount":1300}</script>`,
      "instagram",
      { expectedAudioUrl: instagramUrl, responseUrl: instagramUrl },
    ),
    null,
    "ambiguous counters must fail closed instead of selecting the largest value",
  );
});

test("Instagram playback extraction keeps only strict signed scontent MP4 URLs", async () => {
  const capturedAt = "2026-08-12T10:00:00.000Z";
  const expected = signedPlaybackUrl(capturedAt);
  const html = `${signedPlaybackHtml(capturedAt)}<script>{"url":"https://evil.example/video.mp4?oh=0123456789abcdef&oe=6fffffff"}</script>`;
  assert.deepEqual(extractInstagramSignedPlaybackCandidates(html), [expected]);
  assert.equal(
    instagramPlaybackExpiresAt(expected),
    new Date(Date.parse(capturedAt) + 36 * 60 * 60 * 1_000).toISOString(),
  );

  const requested = [];
  const playback = await collectInstagramSignedPlayback({
    referenceUrl: "https://www.instagram.com/reel/DbieVLOsbLT/",
    capturedAt,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.includes("instagram.com/reel/")) {
        return new Response(signedPlaybackHtml(capturedAt), { status: 200 });
      }
      if (url === expected) return playbackProbeResponse();
      assert.fail(`unexpected playback URL ${url}`);
    },
  });
  assert.deepEqual(playback, {
    url: expected,
    capturedAt,
    expiresAt: new Date(Date.parse(capturedAt) + 36 * 60 * 60 * 1_000).toISOString(),
  });
  assert.equal(requested.length, 2);
});

test("Instagram playback collection fails closed without an attributable playable MP4", async () => {
  await assert.rejects(
    collectInstagramSignedPlayback({
      referenceUrl: "https://www.instagram.com/reel/DbieVLOsbLT/",
      capturedAt: "2026-08-12T10:00:00.000Z",
      fetchImpl: async () => new Response("<html>embed only</html>", { status: 200 }),
    }),
    /URL MP4 Instagram signee absente/i,
  );
});

test("TikTok thumbnails come from the official oEmbed video and an accessible image CDN", async () => {
  const trend = feed.trends.find((candidate) => candidate.platform === "tiktok");
  assert.ok(trend);
  const expectedThumbnail = tiktokThumbnailUrl(trend);
  const requested = [];
  const thumbnail = await collectTikTokThumbnail({
    referenceUrl: trend.referenceVideo.url,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      if (String(url).startsWith("https://www.tiktok.com/oembed?")) {
        assert.equal(new URL(url).searchParams.get("url"), trend.referenceVideo.url);
        return Response.json(tiktokOEmbedPayload(trend));
      }
      if (url === expectedThumbnail) return thumbnailProbeResponse();
      assert.fail(`unexpected TikTok thumbnail URL ${url}`);
    },
  });
  assert.deepEqual(thumbnail, { url: expectedThumbnail });
  assert.equal(requested.length, 2);
  assert.equal(requested[0].options.headers.Accept, "application/json");
  assert.match(requested[1].options.headers.Accept, /^image\//u);
});

test("TikTok thumbnail collection rejects mismatched identities, providers and non-images", async () => {
  const trend = feed.trends.find((candidate) => candidate.platform === "tiktok");
  assert.ok(trend);
  const mismatchedHtml = tiktokOEmbedPayload(trend, {
    html: '<blockquote data-video-id="7999999999999999999"></blockquote>',
  });
  await assert.rejects(
    collectTikTokThumbnail({
      referenceUrl: trend.referenceVideo.url,
      fetchImpl: async () => Response.json(mismatchedHtml),
    }),
    /non attribuable/i,
  );

  await assert.rejects(
    collectTikTokThumbnail({
      referenceUrl: trend.referenceVideo.url,
      fetchImpl: async () => Response.json(tiktokOEmbedPayload(trend, {
        provider_name: "Lookalike",
      })),
    }),
    /non attribuable/i,
  );

  await assert.rejects(
    collectTikTokThumbnail({
      referenceUrl: trend.referenceVideo.url,
      fetchImpl: async () => Response.json(tiktokOEmbedPayload(trend, {
        thumbnail_url: "https://images.example.test/reference.jpg",
      })),
    }),
    /non attribuable/i,
  );

  await assert.rejects(
    collectTikTokThumbnail({
      referenceUrl: trend.referenceVideo.url,
      fetchImpl: async (url) => String(url).startsWith("https://www.tiktok.com/oembed?")
        ? Response.json(tiktokOEmbedPayload(trend))
        : thumbnailProbeResponse({ contentType: "text/html" }),
    }),
    /non image/i,
  );
});

test("publishing requires broad coverage on every tracked provider", () => {
  assert.equal(requiredProviderMatches(8), 6);
  const oneMatch = evaluateAudioRefreshCoverage([
    { platform: "instagram", checked: 8, matched: 1 },
    { platform: "tiktok", checked: 8, matched: 0 },
  ]);
  assert.equal(oneMatch.publishable, false);
  assert.equal(oneMatch.requiredTotal, 12);

  const missingProvider = evaluateAudioRefreshCoverage([
    { platform: "instagram", checked: 8, matched: 8 },
  ]);
  assert.equal(missingProvider.publishable, false);

  const broadCoverage = evaluateAudioRefreshCoverage([
    { platform: "instagram", checked: 8, matched: 6 },
    { platform: "tiktok", checked: 8, matched: 6 },
  ]);
  assert.equal(broadCoverage.publishable, true);
});

test("the scanner never exceeds its configured concurrency", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency(
    Array.from({ length: 20 }, (_, index) => index),
    3,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
  );
  assert.ok(peak <= 3);
  assert.deepEqual(results, Array.from({ length: 20 }, (_, index) => index * 2));
});

test("a complete linked scan updates all counters without mutating the input", async () => {
  const original = structuredClone(feed);
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const requested = [];
  const result = await buildAudioTrendRefresh({
    feed,
    now,
    concurrency: 4,
    fetchImpl: async (url, options) => {
      requested.push(url);
      assert.ok(options.signal instanceof AbortSignal);
      const trend = feed.trends.find((candidate) => candidate.audioUrl === url);
      if (trend) return new Response(counterHtml(trend, latestUses(trend)), { status: 200 });
      const referenceTrend = feed.trends.find((candidate) =>
        candidate.platform === "instagram" && candidate.referenceVideo.url === url
      );
      if (referenceTrend) return new Response(signedPlaybackHtml(now), { status: 200 });
      if (String(url).includes(".cdninstagram.com/")) return playbackProbeResponse();
      const thumbnailTrend = tiktokTrendFromOEmbedRequest(url);
      if (thumbnailTrend) return Response.json(tiktokOEmbedPayload(thumbnailTrend));
      if (String(url).includes(".tiktokcdn.com/")) return thumbnailProbeResponse();
      assert.fail(`unexpected refresh URL ${url}`);
    },
  });

  const trackedTrends = feed.trends.filter((trend) => ["instagram", "tiktok"].includes(trend.platform));
  const instagramTrends = trackedTrends.filter((trend) => trend.platform === "instagram");
  const tiktokTrends = trackedTrends.filter((trend) => trend.platform === "tiktok");
  assert.equal(
    requested.length,
    trackedTrends.length + instagramTrends.length * 2 + tiktokTrends.length * 2,
  );
  assert.equal(result.status.coverage.totalMatched, trackedTrends.length);
  assert.equal(result.status.coverage.instagramPlaybackMatched, instagramTrends.length);
  assert.equal(result.status.coverage.instagramPlaybackComplete, true);
  assert.equal(result.status.coverage.tiktokThumbnailMatched, tiktokTrends.length);
  assert.equal(result.status.coverage.tiktokThumbnailCoverage, 1);
  assert.equal(result.status.coverage.tiktokThumbnailComplete, true);
  assert.equal(result.status.coverage.thumbnailPublishable, true);
  assert.equal(result.status.published, true);
  assert.equal(result.feed.capturedAt, now);
  assert.ok(
    result.feed.trends
      .filter((trend) => ["instagram", "tiktok"].includes(trend.platform))
      .every((trend) => trend.usageObservations.at(-1).capturedAt === now),
  );
  assert.ok(
    result.feed.trends
      .filter((trend) => trend.platform === "instagram")
      .every((trend) =>
        typeof trend.referenceVideo.playbackUrl === "string" &&
        trend.referenceVideo.playbackCapturedAt === now &&
        Date.parse(trend.referenceVideo.playbackExpiresAt) > Date.parse(now)
      ),
  );
  assert.ok(
    result.feed.trends
      .filter((trend) => trend.platform === "tiktok")
      .every((trend) => trend.referenceVideo.thumbnailUrl === tiktokThumbnailUrl(trend)),
  );
  assert.deepEqual(feed, original, "the last validated feed remains untouched until publication");
});

test("all fresh Instagram playbacks can publish degraded without rewriting failed counters", async () => {
  const original = structuredClone(feed);
  const originalObservations = feed.trends.map((trend) => structuredClone(trend.usageObservations));
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const instagramTrends = feed.trends.filter((trend) => trend.platform === "instagram");
  const result = await buildAudioTrendRefresh({
    feed,
    now,
    fetchImpl: async (url) => {
      if (feed.trends.some((trend) => trend.audioUrl === url)) {
        return new Response("counter blocked", { status: 503 });
      }
      if (instagramTrends.some((trend) => trend.referenceVideo.url === url)) {
        return new Response(signedPlaybackHtml(now), { status: 200 });
      }
      if (String(url).includes(".cdninstagram.com/")) return playbackProbeResponse();
      const thumbnailTrend = tiktokTrendFromOEmbedRequest(url);
      if (thumbnailTrend) return Response.json(tiktokOEmbedPayload(thumbnailTrend));
      if (String(url).includes(".tiktokcdn.com/")) return thumbnailProbeResponse();
      assert.fail(`unexpected degraded refresh URL ${url}`);
    },
  });

  assert.equal(result.status.status, "degraded");
  assert.equal(result.status.published, true);
  assert.equal(result.status.coverage.totalMatched, 0);
  assert.equal(result.status.coverage.counterPublishable, false);
  assert.equal(result.status.coverage.instagramPlaybackMatched, instagramTrends.length);
  assert.equal(result.status.coverage.instagramPlaybackComplete, true);
  assert.equal(result.status.coverage.tiktokThumbnailMatched, 8);
  assert.equal(result.status.coverage.tiktokThumbnailComplete, true);
  assert.deepEqual(
    result.feed.trends.map((trend) => trend.usageObservations),
    originalObservations,
    "failed counters must preserve every previous observation",
  );
  assert.equal(result.feed.sourceChecks.find((check) => check.platform === "instagram")?.status, "failed");
  assert.equal(result.feed.sourceChecks.find((check) => check.platform === "tiktok")?.status, "failed");
  assert.ok(
    result.feed.trends
      .filter((trend) => trend.platform === "instagram")
      .every((trend) => trend.referenceVideo.playbackCapturedAt === now),
  );
  assert.deepEqual(feed, original);
});

test("degraded publication fails closed when even one Instagram playback is missing", async () => {
  const original = structuredClone(feed);
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const instagramTrends = feed.trends.filter((trend) => trend.platform === "instagram");
  const missingReferenceUrl = instagramTrends[0].referenceVideo.url;
  let failure;
  try {
    await buildAudioTrendRefresh({
      feed,
      now,
      fetchImpl: async (url) => {
        if (feed.trends.some((trend) => trend.audioUrl === url) || url === missingReferenceUrl) {
          return new Response("blocked", { status: 503 });
        }
        if (instagramTrends.some((trend) => trend.referenceVideo.url === url)) {
          return new Response(signedPlaybackHtml(now), { status: 200 });
        }
        if (String(url).includes(".cdninstagram.com/")) return playbackProbeResponse();
        const thumbnailTrend = tiktokTrendFromOEmbedRequest(url);
        if (thumbnailTrend) return Response.json(tiktokOEmbedPayload(thumbnailTrend));
        if (String(url).includes(".tiktokcdn.com/")) return thumbnailProbeResponse();
        assert.fail(`unexpected partial refresh URL ${url}`);
      },
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  assert.equal(failure.refreshStatus.status, "failed");
  assert.equal(failure.refreshStatus.coverage.instagramPlaybackMatched, instagramTrends.length - 1);
  assert.equal(failure.refreshStatus.coverage.instagramPlaybackComplete, false);
  assert.equal(failure.refreshStatus.coverage.tiktokThumbnailComplete, true);
  assert.equal(failure.refreshStatus.published, false);
  assert.deepEqual(feed, original);
});

test("publication fails closed when even one TikTok thumbnail is missing", async () => {
  const original = structuredClone(feed);
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const instagramTrends = feed.trends.filter((trend) => trend.platform === "instagram");
  const tiktokTrends = feed.trends.filter((trend) => trend.platform === "tiktok");
  const missingThumbnailUrl = tiktokThumbnailUrl(tiktokTrends[0]);
  let failure;
  try {
    await buildAudioTrendRefresh({
      feed,
      now,
      fetchImpl: async (url) => {
        const counterTrend = feed.trends.find((trend) => trend.audioUrl === url);
        if (counterTrend) {
          return new Response(counterHtml(counterTrend, latestUses(counterTrend)), { status: 200 });
        }
        if (instagramTrends.some((trend) => trend.referenceVideo.url === url)) {
          return new Response(signedPlaybackHtml(now), { status: 200 });
        }
        if (String(url).includes(".cdninstagram.com/")) return playbackProbeResponse();
        const thumbnailTrend = tiktokTrendFromOEmbedRequest(url);
        if (thumbnailTrend) return Response.json(tiktokOEmbedPayload(thumbnailTrend));
        if (url === missingThumbnailUrl) return new Response("missing", { status: 404 });
        if (String(url).includes(".tiktokcdn.com/")) return thumbnailProbeResponse();
        assert.fail(`unexpected thumbnail coverage URL ${url}`);
      },
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  assert.match(failure.message, /miniature TikTok insuffisante: 7\/8/i);
  assert.equal(failure.refreshStatus.status, "failed");
  assert.equal(failure.refreshStatus.coverage.counterPublishable, true);
  assert.equal(failure.refreshStatus.coverage.instagramPlaybackComplete, true);
  assert.equal(failure.refreshStatus.coverage.tiktokThumbnailMatched, tiktokTrends.length - 1);
  assert.equal(failure.refreshStatus.coverage.tiktokThumbnailCoverage, 7 / 8);
  assert.equal(failure.refreshStatus.coverage.tiktokThumbnailComplete, false);
  assert.equal(failure.refreshStatus.coverage.thumbnailPublishable, false);
  const tiktokProvider = failure.refreshStatus.providers.find((provider) => provider.platform === "tiktok");
  assert.equal(tiktokProvider.thumbnailMatched, tiktokTrends.length - 1);
  assert.equal(tiktokProvider.thumbnailCoverage, 7 / 8);
  assert.match(tiktokProvider.errors.join(" "), /miniatures insuffisante: 7\/8/i);
  assert.equal(failure.refreshStatus.published, false);
  assert.deepEqual(feed, original);
});

test("one successful counter can never publish over the last validated feed", async () => {
  const original = structuredClone(feed);
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const soleSuccess = feed.trends.find((trend) => trend.platform === "tiktok");
  assert.ok(soleSuccess);

  let failure;
  try {
    await buildAudioTrendRefresh({
      feed,
      now,
      fetchImpl: async (url) => url === soleSuccess.audioUrl
        ? new Response(counterHtml(soleSuccess, latestUses(soleSuccess)), { status: 200 })
        : new Response("blocked", { status: 503 }),
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  assert.equal(failure.refreshStatus.published, false);
  assert.equal(failure.refreshStatus.coverage.totalMatched, 1);
  assert.equal(failure.refreshStatus.coverage.instagramPlaybackMatched, 0);
  assert.deepEqual(feed, original);
});
