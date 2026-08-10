import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertSocialTrendFeed,
  filterSocialTrends,
  rankSocialTrends,
  TREND_PRIORITY_THRESHOLD,
  trendPriorityScore,
} from "../lib/social-trends.ts";

const feed = JSON.parse(
  await readFile(new URL("../data/trends/feed.json", import.meta.url), "utf8"),
);

const NULL_REFERENCE_TRENDS = new Set([
  "eclipse-perseides-12-aout",
  "heatwave-tatooine",
]);

function referenceUrlMatchesPlatform(referencePost) {
  const url = new URL(referencePost.url);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  if (referencePost.platform === "instagram") {
    return (host === "instagram.com" || host.endsWith(".instagram.com")) &&
      /^\/(?:p|reel)\/[^/]+$/i.test(path);
  }
  if (referencePost.platform === "tiktok") {
    return (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
      /^\/@[^/]+\/video\/\d{12,24}$/i.test(path);
  }
  if (referencePost.platform === "youtube") {
    return (host === "youtube.com" || host.endsWith(".youtube.com")) &&
      /^\/shorts\/[A-Za-z0-9_-]{11}$/i.test(path);
  }
  return (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) &&
    /^\/[^/]+\/status\/\d+$/i.test(path);
}

function cloneWithFirstReferencePost() {
  const snapshot = structuredClone(feed);
  const trend = snapshot.trends.find((candidate) => candidate.referencePost !== null);
  assert.ok(trend?.referencePost, "the fixture must contain a reference post");
  return { snapshot, trend, referencePost: trend.referencePost };
}

test("the current snapshot is complete, sourced and honest about missing metrics", () => {
  assert.equal(assertSocialTrendFeed(feed), feed);
  assert.equal(feed.version, 2);
  assert.ok(Date.parse(feed.capturedAt) >= Date.parse("2026-08-10T00:00:00+02:00"));
  assert.ok(feed.trends.length >= 12);
  assert.equal(new Set(feed.trends.map((trend) => trend.id)).size, feed.trends.length);

  const trendsWithReference = feed.trends.filter((trend) => trend.referencePost !== null);
  const trendsWithoutReference = feed.trends.filter((trend) => trend.referencePost === null);
  assert.equal(trendsWithReference.length, 16);
  assert.equal(trendsWithoutReference.length, 2);
  assert.deepEqual(
    new Set(trendsWithoutReference.map((trend) => trend.id)),
    NULL_REFERENCE_TRENDS,
  );

  for (const trend of feed.trends) {
    assert.ok(trend.observations.length >= 1, trend.id);
    assert.deepEqual(
      new Set(trend.proposals.map((proposal) => proposal.tone)),
      new Set(["complice", "cozy", "absurde"]),
      trend.id,
    );
    assert.ok(trend.proposals.every((proposal) => proposal.concept && proposal.copy), trend.id);
    assert.ok(trend.observations.every((observation) => observation.sourceUrl.startsWith("https://")), trend.id);
    assert.ok(
      trend.observations
        .filter((observation) => observation.exactness === "editorial-observation")
        .every((observation) =>
          [observation.rank, observation.posts, observation.views, observation.uses]
            .every((metric) => metric === null),
        ),
      `${trend.id} must not expose an editorial report as a platform metric`,
    );

    if (trend.referencePost === null) {
      assert.ok(
        trend.observations.every(
          (observation) => observation.exactness === "editorial-observation",
        ),
        `${trend.id} must stay null until a direct platform post is sourced`,
      );
      continue;
    }

    const referencePost = trend.referencePost;
    assert.ok(trend.platforms.includes(referencePost.platform), trend.id);
    assert.ok(referenceUrlMatchesPlatform(referencePost), trend.id);
    assert.equal(new URL(referencePost.url).protocol, "https:", trend.id);
    assert.equal(new URL(referencePost.sourceUrl).protocol, "https:", trend.id);
    if (referencePost.thumbnailUrl !== null) {
      assert.equal(new URL(referencePost.thumbnailUrl).protocol, "https:", trend.id);
    }
    assert.ok(Number.isFinite(Date.parse(referencePost.capturedAt)), trend.id);
    assert.ok(
      Date.parse(referencePost.capturedAt) <= Date.parse(feed.capturedAt),
      trend.id,
    );
    if (referencePost.publishedAt !== null) {
      assert.ok(Number.isFinite(Date.parse(referencePost.publishedAt)), trend.id);
    }
    for (const metric of Object.values(referencePost.metrics)) {
      assert.ok(
        metric === null || (Number.isFinite(metric) && metric >= 0),
        trend.id,
      );
    }
    if (referencePost.exactness === "editorial-observation") {
      assert.ok(
        Object.values(referencePost.metrics).every((metric) => metric === null),
        trend.id,
      );
    }
  }

  assert.ok(
    feed.trends.some((trend) =>
      trend.observations.some((observation) => observation.views === null),
    ),
    "missing public metrics must stay null instead of being invented",
  );
});

test("runtime validation rejects an unknown lifecycle and an unverifiable source", () => {
  assert.throws(() => assertSocialTrendFeed(null), /snapshot trends invalide/i);

  const invalidLifecycle = structuredClone(feed);
  invalidLifecycle.trends[0].lifecycle = "viral-ish";
  assert.throws(() => assertSocialTrendFeed(invalidLifecycle), /invalide/i);

  const invalidSource = structuredClone(feed);
  invalidSource.trends[0].observations[0].sourceUrl = "not-a-source";
  assert.throws(() => assertSocialTrendFeed(invalidSource), /observation invalide/i);
});

test("reference posts reject a foreign domain, an incoherent platform and a future capture", () => {
  const invalidDomain = cloneWithFirstReferencePost();
  invalidDomain.referencePost.url = "https://example.com/reel/not-a-platform-post";
  assert.throws(
    () => assertSocialTrendFeed(invalidDomain.snapshot),
    /Post de référence invalide/i,
  );

  const invalidPlatform = cloneWithFirstReferencePost();
  invalidPlatform.referencePost.platform = "threads";
  assert.throws(
    () => assertSocialTrendFeed(invalidPlatform.snapshot),
    /Post de référence invalide/i,
  );

  const futureCapture = cloneWithFirstReferencePost();
  futureCapture.referencePost.capturedAt = "2100-01-01T00:00:00.000Z";
  assert.throws(
    () => assertSocialTrendFeed(futureCapture.snapshot),
    /Post de référence invalide/i,
  );
});

test("reference posts reject negative or editorially inferred metrics", () => {
  const negativeMetric = cloneWithFirstReferencePost();
  negativeMetric.referencePost.metrics.likes = -1;
  assert.throws(
    () => assertSocialTrendFeed(negativeMetric.snapshot),
    /Post de référence invalide/i,
  );

  const editorialMetric = cloneWithFirstReferencePost();
  editorialMetric.referencePost.exactness = "editorial-observation";
  editorialMetric.referencePost.metrics = {
    views: 1,
    likes: null,
    comments: null,
    shares: null,
  };
  assert.throws(
    () => assertSocialTrendFeed(editorialMetric.snapshot),
    /Post de référence invalide/i,
  );
});

test("ranking and feed filters surface the strongest Lofi Girl opportunities", () => {
  const ranked = rankSocialTrends(feed.trends);
  assert.ok(trendPriorityScore(ranked[0]) >= trendPriorityScore(ranked.at(-1)));
  assert.ok(ranked.every((trend) => trendPriorityScore(trend) >= 0));

  const instagram = filterSocialTrends(feed.trends, { platform: "instagram" });
  assert.ok(instagram.length > 0);
  assert.ok(instagram.every((trend) => trend.platforms.includes("instagram")));

  const priorities = filterSocialTrends(feed.trends, { lifecycle: "priority" });
  assert.ok(priorities.length > 0);
  assert.ok(priorities.length < feed.trends.length);
  assert.ok(
    priorities.every(
      (trend) => trendPriorityScore(trend) >= TREND_PRIORITY_THRESHOLD,
    ),
  );
});
