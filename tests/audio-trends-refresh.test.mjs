import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAudioTrendRefresh,
  evaluateAudioRefreshCoverage,
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
      assert.ok(trend);
      return new Response(counterHtml(trend, latestUses(trend)), { status: 200 });
    },
  });

  const trackedTrends = feed.trends.filter((trend) => ["instagram", "tiktok"].includes(trend.platform));
  assert.equal(requested.length, trackedTrends.length);
  assert.equal(result.status.coverage.totalMatched, trackedTrends.length);
  assert.equal(result.status.published, true);
  assert.equal(result.feed.capturedAt, now);
  assert.ok(
    result.feed.trends
      .filter((trend) => ["instagram", "tiktok"].includes(trend.platform))
      .every((trend) => trend.usageObservations.at(-1).capturedAt === now),
  );
  assert.deepEqual(feed, original, "the last validated feed remains untouched until publication");
});

test("one successful counter can never publish over the last validated feed", async () => {
  const original = structuredClone(feed);
  const now = new Date(Date.parse(feed.capturedAt) + 25 * 60 * 60 * 1_000).toISOString();
  const soleSuccess = feed.trends.find((trend) => ["instagram", "tiktok"].includes(trend.platform));
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
  assert.deepEqual(feed, original);
});
