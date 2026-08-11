import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUDIENCE_ENGAGEMENT_FORMULA,
  assertAudienceHistory,
  audienceGrowth,
  calculatePlatformEngagement,
  latestAudienceObservation,
  recalculateAudienceEngagement,
} from "../lib/audience-metrics.ts";
import {
  collectAudienceHistory,
  compactCount,
} from "../scripts/collect-audience-history.mjs";

const historyPath = new URL("../data/audience-history.json", import.meta.url);
const postsPath = new URL("../data/public-history.json", import.meta.url);
const history = assertAudienceHistory(
  JSON.parse(await readFile(historyPath, "utf8")),
);
const publicHistory = JSON.parse(await readFile(postsPath, "utf8"));

test("validates the real version 1 seed and its 11 August follower totals", () => {
  assert.equal(history.version, 1);
  assertSeedObservation("youtube", 15_800_000, "platform-rounded");
  assertSeedObservation("instagram", 1_427_842, "exact");
  assertSeedObservation("tiktok", 1_548_859, "exact");
  assertSeedObservation("x", 260_800, "platform-rounded");
});

test("rejects invented zeroes, non-HTTPS sources and unknown precision", () => {
  const zero = structuredClone(history);
  zero.platforms.instagram.observations.at(-1).followers = 0;
  assert.throws(() => assertAudienceHistory(zero), /strictement positif/i);

  const insecure = structuredClone(history);
  insecure.platforms.tiktok.observations.at(-1).sourceUrl = "http://example.com";
  assert.throws(() => assertAudienceHistory(insecure), /HTTPS/i);

  const guessed = structuredClone(history);
  guessed.platforms.x.observations.at(-1).precision = "estimated";
  assert.throws(() => assertAudienceHistory(guessed), /precision/i);
});

test("finds the latest point without relying on array order", () => {
  const platform = structuredClone(history.platforms.x);
  platform.observations.reverse();
  assert.equal(latestAudienceObservation(platform).followers, 260_800);
});

test("calculates growth from observed points and never interpolates a missing day", () => {
  const platform = {
    profileUrl: "https://example.com/profile",
    engagement: null,
    observations: [
      observation("2026-07-01T00:00:00.000Z", 500),
      observation("2026-08-04T00:00:00.000Z", 1_000),
      observation("2026-08-11T00:00:00.000Z", 1_100),
    ],
  };
  const weekly = audienceGrowth(platform, { days: 7, toleranceDays: 0 });
  assert.equal(weekly.followersDelta, 100);
  assert.equal(weekly.ratePercent, 10);
  assert.equal(weekly.elapsedDays, 7);
  assert.equal(weekly.from.followers, 1_000);
  assert.equal(weekly.to.followers, 1_100);

  assert.equal(
    audienceGrowth(platform, { days: 30, toleranceDays: 1 }),
    null,
    "the 2026-07-01 milestone is not silently moved to the 30-day target",
  );
  assert.equal(audienceGrowth(platform).from.followers, 500);
});

test("uses the latest 30 eligible posts and excludes owner YouTube comments", () => {
  const latest = observation("2026-08-11T00:00:00.000Z", 1_000, "exact");
  const posts = Array.from({ length: 30 }, (_, index) => ({
    platform: "youtube",
    format: index % 2 ? "short" : "community_image",
    publishedAt: new Date(Date.UTC(2026, 7, 10 - index)).toISOString(),
    likes: 9,
    comments: 1,
  }));
  posts.push({
    platform: "youtube",
    format: "short",
    publishedAt: "2020-01-01T00:00:00.000Z",
    likes: 999,
    comments: 1,
  });
  posts.push({
    platform: "youtube",
    format: "comment",
    publishedAt: "2026-08-11T01:00:00.000Z",
    likes: 50_000,
    comments: 50_000,
  });
  posts.push({
    platform: "youtube",
    format: "short",
    publishedAt: "2026-08-11T02:00:00.000Z",
    likes: null,
    comments: 4,
  });

  const engagement = calculatePlatformEngagement(
    "youtube",
    posts,
    latest,
    "2026-08-11T03:00:00.000Z",
  );
  assert.equal(engagement.formula, AUDIENCE_ENGAGEMENT_FORMULA);
  assert.equal(engagement.sampleSize, 30);
  assert.equal(engagement.averageInteractions, 10);
  assert.equal(engagement.ratePercent, 1);
  assert.equal(engagement.followers, 1_000);
});

test("precomputes engagement for every platform from the public history", () => {
  const recalculated = recalculateAudienceEngagement(
    history,
    publicHistory.posts,
    history.generatedAt,
  );
  for (const platform of ["youtube", "instagram", "tiktok", "x"]) {
    const engagement = recalculated.platforms[platform].engagement;
    assert.ok(engagement, `${platform} should have an engagement sample`);
    assert.deepEqual(
      history.platforms[platform].engagement,
      engagement,
      `${platform} stored engagement must match the current public history`,
    );
    assert.equal(engagement.sampleSize, 30);
    assert.equal(engagement.formula, AUDIENCE_ENGAGEMENT_FORMULA);
    assert.ok(engagement.averageInteractions >= 0);
    assert.ok(engagement.ratePercent >= 0);
  }
});

test("a partial daily collection appends successes and preserves failed platforms", async () => {
  const latestTime = Math.max(
    ...["youtube", "instagram", "tiktok", "x"].map((platform) =>
      Date.parse(latestAudienceObservation(history.platforms[platform]).capturedAt)),
  );
  const capturedAt = new Date(latestTime + 24 * 60 * 60 * 1_000).toISOString();
  const beforeInstagram = history.platforms.instagram.observations.length;
  const beforeX = history.platforms.x.observations.length;
  const nextYouTube = latestAudienceObservation(history.platforms.youtube).followers + 1;
  const nextTikTok = latestAudienceObservation(history.platforms.tiktok).followers + 1;
  const collectors = {
    youtube: async () => observation(capturedAt, nextYouTube, "platform-rounded"),
    instagram: async () => { throw new Error("Meta indisponible"); },
    tiktok: async () => observation(capturedAt, nextTikTok, "exact"),
    x: async () => { throw new Error("X indisponible"); },
  };
  const result = await collectAudienceHistory({
    historyPath,
    postsPath,
    collectors,
    now: capturedAt,
    write: false,
  });

  assert.deepEqual(result.successes.map((item) => item.platform), ["youtube", "tiktok"]);
  assert.deepEqual(result.failures.map((item) => item.platform), ["instagram", "x"]);
  assert.equal(
    result.history.platforms.instagram.observations.length,
    beforeInstagram,
  );
  assert.equal(result.history.platforms.x.observations.length, beforeX);
  assert.equal(
    latestAudienceObservation(result.history.platforms.youtube).followers,
    nextYouTube,
  );
});

test("keeps only the latest real observation when two collectors run the same Paris day", async () => {
  const capturedAt = "2026-08-11T20:00:00.000Z";
  const nextFollowers = latestAudienceObservation(history.platforms.youtube).followers + 1;
  const collectors = Object.fromEntries(
    ["youtube", "instagram", "tiktok", "x"].map((platform) => [
      platform,
      async () => observation(
        capturedAt,
        platform === "youtube"
          ? nextFollowers
          : latestAudienceObservation(history.platforms[platform]).followers,
        platform === "youtube" || platform === "x" ? "platform-rounded" : "exact",
      ),
    ]),
  );
  const result = await collectAudienceHistory({
    historyPath,
    postsPath,
    collectors,
    now: capturedAt,
    write: false,
  });

  assert.equal(
    result.history.platforms.youtube.observations.length,
    history.platforms.youtube.observations.length,
  );
  assert.equal(
    latestAudienceObservation(result.history.platforms.youtube).followers,
    nextFollowers,
  );
});

test("parses only explicit compact follower counters", () => {
  assert.equal(compactCount("15.8M"), 15_800_000);
  assert.equal(compactCount("1,548,859"), 1_548_859);
  assert.equal(compactCount("260.8K"), 260_800);
  assert.equal(compactCount("followers unknown"), null);
  assert.equal(compactCount("0"), null);
});

function observation(
  capturedAt,
  followers,
  precision = "milestone",
) {
  return {
    capturedAt,
    followers,
    precision,
    sourceUrl: "https://example.com/source",
    label: "Relevé réel de test",
  };
}

function assertSeedObservation(platform, followers, precision) {
  const seed = history.platforms[platform].observations.find(
    (item) =>
      item.capturedAt.startsWith("2026-08-11") &&
      item.followers === followers,
  );
  assert.ok(seed, `${platform} must retain its 11/08/2026 seed`);
  assert.equal(seed.precision, precision);
}
