import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDailyTrendRefresh,
  countMatchedSignals,
  localDateKey,
  normalizeSourceText,
} from "../scripts/refresh-social-trends.mjs";
import {
  assertPublishableSocialTrendFeed,
  isActionableSocialTrend,
} from "../lib/social-trends.ts";

const feed = JSON.parse(
  await readFile(new URL("../data/trends/feed.json", import.meta.url), "utf8"),
);
const watchlists = JSON.parse(
  await readFile(new URL("../data/trends/watchlists.json", import.meta.url), "utf8"),
);

function successfulSourceFetch(url) {
  const source = watchlists.sources.find((candidate) => candidate.url === url);
  assert.ok(source, `unexpected source ${url}`);
  const trendTerms = feed.trends
    .filter(isActionableSocialTrend)
    .slice(0, 8)
    .flatMap((trend) => [trend.title, ...trend.keywords])
    .join(" ");
  if (source.kind === "x-api") {
    return Promise.resolve(Response.json({
      data: [{ trend_name: trendTerms }],
    }));
  }
  return Promise.resolve(new Response(
    `<html><body>${source.requiredMarkers.join(" ")} ${trendTerms}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  ));
}

test("source text normalization and matching are deterministic", () => {
  assert.equal(normalizeSourceText("<h1>ÉTUDES&nbsp;&amp; Focus</h1>"), "etudes & focus");
  const actionable = feed.trends.filter(isActionableSocialTrend);
  assert.ok(countMatchedSignals(actionable[0].title, actionable) >= 1);
});

test("a real parsed-source run refreshes metadata without altering native metrics", async () => {
  const originalReferences = feed.trends.map((trend) => trend.referencePost);
  const now = "2026-08-11T06:17:00.000+02:00";
  const result = await buildDailyTrendRefresh({
    feed,
    watchlists,
    now,
    force: true,
    fetchImpl: successfulSourceFetch,
    xBearerToken: "test-token",
  });

  assert.equal(result.skipped, false);
  assert.equal(result.feed.capturedAt, now);
  assert.equal(result.feed.refresh.status, "success");
  assert.equal(result.feed.refresh.lastSuccessfulAt, now);
  assert.equal(result.feed.refresh.sourceChecks.length, watchlists.sources.length);
  assert.equal(result.feed.refresh.counts.checkedSources, watchlists.sources.length);
  assert.ok(result.feed.refresh.counts.matchedSignals > 0);
  assert.ok(result.feed.refresh.counts.actionable >= 50);
  assert.ok(result.feed.refresh.counts.lofiGirl >= 40);
  assert.deepEqual(
    result.feed.trends.map((trend) => trend.referencePost),
    originalReferences,
    "an editorial source check must never rewrite native post metrics",
  );
  assert.equal(assertPublishableSocialTrendFeed(result.feed, { now }), result.feed);
});

test("the daily publisher fails closed when too few sources parse", async () => {
  await assert.rejects(
    buildDailyTrendRefresh({
      feed,
      watchlists,
      now: "2026-08-11T06:17:00.000+02:00",
      force: true,
      fetchImpl: async () => new Response("blocked", { status: 503 }),
    }),
    /sources Trends ont été parsées/i,
  );
});

test("the retry slot skips paid or remote work after a success on the same Paris day", async () => {
  let fetchCount = 0;
  const result = await buildDailyTrendRefresh({
    feed,
    watchlists,
    now: feed.refresh.lastSuccessfulAt,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("must not fetch");
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(fetchCount, 0);
  assert.equal(
    localDateKey(result.feed.refresh.lastSuccessfulAt),
    localDateKey(feed.refresh.lastSuccessfulAt),
  );
});
