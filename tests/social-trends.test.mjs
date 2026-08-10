import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertSocialTrendFeed,
  filterSocialTrends,
  isActionableSocialTrend,
  isQualifiedTrendReferencePost,
  MAX_TREND_VIDEO_DURATION_SECONDS,
  MIN_ACTIONABLE_TREND_LOFI_FIT,
  MIN_TREND_VIDEO_LIKES,
  rankSocialTrends,
  TREND_PRIORITY_THRESHOLD,
  trendPriorityScore,
} from "../lib/social-trends.ts";

const feed = JSON.parse(
  await readFile(new URL("../data/trends/feed.json", import.meta.url), "utf8"),
);

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

function cloneWithFirstVideoReferencePost() {
  const snapshot = structuredClone(feed);
  const trend = snapshot.trends.find(
    (candidate) => candidate.referencePost?.mediaType === "video",
  );
  assert.ok(trend?.referencePost, "the fixture must contain a video reference post");
  return { snapshot, trend, referencePost: trend.referencePost };
}

function cloneWithFirstNonVideoReferencePost() {
  const snapshot = structuredClone(feed);
  const trend = snapshot.trends.find(
    (candidate) => candidate.referencePost && candidate.referencePost.mediaType !== "video",
  );
  assert.ok(trend?.referencePost, "the fixture must contain a non-video reference post");
  return { snapshot, trend, referencePost: trend.referencePost };
}

test("the current snapshot is complete, sourced and honest about missing metrics", () => {
  assert.equal(assertSocialTrendFeed(feed), feed);
  assert.equal(feed.version, 4);
  assert.ok(Date.parse(feed.capturedAt) >= Date.parse("2026-08-10T00:00:00+02:00"));
  assert.ok(feed.trends.length >= 30);
  assert.equal(new Set(feed.trends.map((trend) => trend.id)).size, feed.trends.length);

  const trendsWithReference = feed.trends.filter((trend) => trend.referencePost !== null);
  const trendsWithoutReference = feed.trends.filter((trend) => trend.referencePost === null);
  assert.ok(trendsWithReference.length > 18);
  assert.ok(trendsWithoutReference.length >= 2);

  for (const trend of feed.trends) {
    assert.ok(["lofi-girl", "lofi-boy"].includes(trend.character), trend.id);
    assert.ok(trend.territory.trim().length > 0, trend.id);
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
      continue;
    }

    const referencePost = trend.referencePost;
    assert.equal(isQualifiedTrendReferencePost(referencePost), true, trend.id);
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
    if (referencePost.mediaType === "video") {
      assert.ok(
        referencePost.metrics.likes >= MIN_TREND_VIDEO_LIKES,
        `${trend.id} must clear the public video-like threshold`,
      );
      assert.ok(
        referencePost.durationSeconds > 0 &&
          referencePost.durationSeconds < MAX_TREND_VIDEO_DURATION_SECONDS,
        `${trend.id} must be a verified video under 30 seconds`,
      );
    } else {
      assert.equal(referencePost.durationSeconds, null, trend.id);
    }
    if (referencePost.exactness === "editorial-observation") {
      assert.ok(
        Object.values(referencePost.metrics).every((metric) => metric === null),
        trend.id,
      );
    }
  }

  assert.equal(
    feed.trends.find((trend) => trend.id === "matrix-verity-edit")?.referencePost?.durationSeconds,
    13,
  );
  for (const excludedId of [
    "back-to-school-study-reset",
    "youll-never-see-it-coming",
    "not-a-relaxing-environment",
  ]) {
    assert.equal(feed.trends.find((trend) => trend.id === excludedId)?.referencePost, null);
  }

  assert.ok(
    feed.trends.some((trend) =>
      trend.observations.some((observation) => observation.views === null),
    ),
    "missing public metrics must stay null instead of being invented",
  );
});

test("the actionable feed keeps only strong, qualified Lofi-universe executions", () => {
  const actionable = feed.trends.filter(isActionableSocialTrend);
  assert.ok(actionable.length >= 25, "the feed must expose at least 25 actionable trends");
  assert.ok(
    actionable.every((trend) => trend.lofiFitScore >= MIN_ACTIONABLE_TREND_LOFI_FIT),
    "every actionable trend must clear the Lofi-fit threshold",
  );
  assert.ok(
    actionable.every((trend) => isQualifiedTrendReferencePost(trend.referencePost)),
    "every actionable trend must keep a qualified reference post",
  );

  for (const rejectedId of [
    "pain-oh-no-spain",
    "choosin-texas-western-reveal",
    "ss26-editorial-transition",
    "dracula-jennie-remix",
    "eurosummer-micro-montage",
    "is-it-cake-or-fake",
  ]) {
    const trend = feed.trends.find((candidate) => candidate.id === rejectedId);
    assert.ok(trend, `${rejectedId} must remain auditable in the snapshot`);
    assert.equal(isActionableSocialTrend(trend), false, rejectedId);
  }

  for (const actionableId of [
    "broken-rules-temptation",
    "different-lives-split",
    "suspect-hidden-plain-sight",
    "pocketful-sunshine-mood-flip",
    "phones-eras-study-desk",
    "she-outplayed-him-study-cat",
    "fun-at-first-exam-week",
    "backrooms-stay-in-character-lofi-boy",
    "obsession-nice-date-lofi-boy",
    "gaming-setup-night-reveal",
    "social-battery-solo-mode",
    "discord-eh-les-copains",
    "explaining-game-lore",
    "video-game-main-menu",
    "choose-your-lofi-character",
  ]) {
    const trend = feed.trends.find((candidate) => candidate.id === actionableId);
    assert.ok(trend, `${actionableId} must be present in the actionable feed`);
    assert.equal(isActionableSocialTrend(trend), true, actionableId);
  }

  const lofiBoyTrends = actionable.filter((trend) => trend.character === "lofi-boy");
  assert.ok(lofiBoyTrends.length >= 8, "the feed must expose a real Lofi Boy selection");
  assert.ok(
    lofiBoyTrends.some((trend) => trend.territory.toLowerCase().includes("introversion")),
    "Lofi Boy must cover introversion",
  );
  assert.ok(
    lofiBoyTrends.some((trend) => trend.territory.toLowerCase().includes("cinéma")),
    "Lofi Boy must cover recent film culture",
  );
});

test("the actionable Lofi-fit threshold changes exactly between 84 and 85", () => {
  assert.equal(MIN_ACTIONABLE_TREND_LOFI_FIT, 85);
  const qualified = feed.trends.find((trend) =>
    isQualifiedTrendReferencePost(trend.referencePost),
  );
  assert.ok(qualified, "the fixture must contain a qualified trend reference");

  const belowThreshold = structuredClone(qualified);
  belowThreshold.lofiFitScore = 84;
  assert.equal(isActionableSocialTrend(belowThreshold), false);

  const atThreshold = structuredClone(qualified);
  atThreshold.lofiFitScore = 85;
  assert.equal(isActionableSocialTrend(atThreshold), true);
});

test("runtime validation rejects an unknown lifecycle and an unverifiable source", () => {
  assert.throws(() => assertSocialTrendFeed(null), /snapshot trends invalide/i);

  const invalidLifecycle = structuredClone(feed);
  invalidLifecycle.trends[0].lifecycle = "viral-ish";
  assert.throws(() => assertSocialTrendFeed(invalidLifecycle), /invalide/i);

  const invalidSource = structuredClone(feed);
  invalidSource.trends[0].observations[0].sourceUrl = "not-a-source";
  assert.throws(() => assertSocialTrendFeed(invalidSource), /observation invalide/i);

  const invalidCharacter = structuredClone(feed);
  invalidCharacter.trends[0].character = "lofi-cat";
  assert.throws(() => assertSocialTrendFeed(invalidCharacter), /invalide/i);

  const missingTerritory = structuredClone(feed);
  missingTerritory.trends[0].territory = "";
  assert.throws(() => assertSocialTrendFeed(missingTerritory), /invalide/i);
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

test("video references enforce 50,000 likes and a verified duration under 30 seconds", () => {
  const belowThreshold = cloneWithFirstVideoReferencePost();
  belowThreshold.referencePost.metrics.likes = MIN_TREND_VIDEO_LIKES - 1;
  assert.throws(
    () => assertSocialTrendFeed(belowThreshold.snapshot),
    /Post de référence invalide/i,
  );

  const missingLikes = cloneWithFirstVideoReferencePost();
  missingLikes.referencePost.metrics.likes = null;
  assert.throws(
    () => assertSocialTrendFeed(missingLikes.snapshot),
    /Post de référence invalide/i,
  );

  for (const invalidDuration of [null, 0, 30, 30.001, Number.POSITIVE_INFINITY]) {
    const invalid = cloneWithFirstVideoReferencePost();
    invalid.referencePost.durationSeconds = invalidDuration;
    assert.throws(
      () => assertSocialTrendFeed(invalid.snapshot),
      /Post de référence invalide/i,
    );
  }

  const justBelowLimit = cloneWithFirstVideoReferencePost();
  justBelowLimit.referencePost.durationSeconds = 29.999;
  assert.equal(assertSocialTrendFeed(justBelowLimit.snapshot), justBelowLimit.snapshot);

  const durationOnImage = cloneWithFirstNonVideoReferencePost();
  durationOnImage.referencePost.durationSeconds = 12;
  assert.throws(
    () => assertSocialTrendFeed(durationOnImage.snapshot),
    /Post de référence invalide/i,
  );
});

test("ranking and feed filters surface the strongest opportunities by platform and universe", () => {
  const ranked = rankSocialTrends(feed.trends);
  assert.ok(trendPriorityScore(ranked[0]) >= trendPriorityScore(ranked.at(-1)));
  assert.ok(ranked.every((trend) => trendPriorityScore(trend) >= 0));

  const instagram = filterSocialTrends(feed.trends, { platform: "instagram" });
  assert.ok(instagram.length > 0);
  assert.ok(instagram.every((trend) => trend.platforms.includes("instagram")));

  const lofiBoy = filterSocialTrends(feed.trends, { character: "lofi-boy" });
  assert.ok(lofiBoy.length >= 8);
  assert.ok(lofiBoy.every((trend) => trend.character === "lofi-boy"));

  const priorities = filterSocialTrends(feed.trends, { lifecycle: "priority" });
  assert.ok(priorities.length > 0);
  assert.ok(priorities.length < feed.trends.length);
  assert.ok(
    priorities.every(
      (trend) => trendPriorityScore(trend) >= TREND_PRIORITY_THRESHOLD,
    ),
  );
});
