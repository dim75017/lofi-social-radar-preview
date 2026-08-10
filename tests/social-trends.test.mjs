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

test("the current snapshot is complete, sourced and honest about missing metrics", () => {
  assert.equal(assertSocialTrendFeed(feed), feed);
  assert.ok(Date.parse(feed.capturedAt) >= Date.parse("2026-08-10T00:00:00+02:00"));
  assert.ok(feed.trends.length >= 12);
  assert.equal(new Set(feed.trends.map((trend) => trend.id)).size, feed.trends.length);

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
  }

  assert.ok(
    feed.trends.some((trend) =>
      trend.observations.some((observation) => observation.views === null),
    ),
    "missing public metrics must stay null instead of being invented",
  );
});

test("runtime validation rejects an unknown lifecycle and an unverifiable source", () => {
  const invalidLifecycle = structuredClone(feed);
  invalidLifecycle.trends[0].lifecycle = "viral-ish";
  assert.throws(() => assertSocialTrendFeed(invalidLifecycle), /invalide/i);

  const invalidSource = structuredClone(feed);
  invalidSource.trends[0].observations[0].sourceUrl = "not-a-source";
  assert.throws(() => assertSocialTrendFeed(invalidSource), /observation invalide/i);
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
