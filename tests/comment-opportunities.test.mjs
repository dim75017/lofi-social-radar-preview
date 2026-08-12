import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertCommentOpportunityFeed,
  commentOpportunityRankScore,
  commentOpportunityPriorityScore,
  hasCommentOpportunityAccelerationEvidence,
  isNativeCommentOpportunityUrl,
  rankCommentOpportunities,
} from "../lib/comment-opportunities.ts";

const feed = JSON.parse(
  await readFile(new URL("../data/comment-opportunities/feed.json", import.meta.url), "utf8"),
);

test("the comment opportunity feed covers every platform with native videos", () => {
  assert.equal(assertCommentOpportunityFeed(feed), feed);
  assert.equal(feed.version, 1);
  assert.equal(feed.cadenceHours, 6);
  assert.ok(Date.parse(feed.nextRefreshAt) > Date.parse(feed.capturedAt));
  assert.equal(feed.sourceChecks.length, 4);

  for (const platform of ["youtube", "instagram", "tiktok", "x"]) {
    const opportunities = feed.opportunities.filter((item) => item.platform === platform);
    assert.ok(opportunities.length >= 4, `${platform} needs at least four live opportunities`);
    assert.ok(
      feed.sourceChecks.some((check) => check.platform === platform && check.status !== "failed"),
      `${platform} needs a usable source check`,
    );
  }

  assert.equal(new Set(feed.opportunities.map((item) => item.id)).size, feed.opportunities.length);
  assert.equal(new Set(feed.opportunities.map((item) => item.url)).size, feed.opportunities.length);
  for (const opportunity of feed.opportunities) {
    assert.equal(opportunity.mediaType, "video", opportunity.id);
    assert.equal(isNativeCommentOpportunityUrl(opportunity.url, opportunity.platform), true, opportunity.id);
    assert.equal(opportunity.priorityScore, commentOpportunityPriorityScore(opportunity), opportunity.id);
    assert.equal(opportunity.observations.at(-1).capturedAt, opportunity.capturedAt, opportunity.id);
    assert.deepEqual(
      new Set(opportunity.comments.map((comment) => comment.tone)),
      new Set(["funny", "smart", "complice"]),
      opportunity.id,
    );
    for (const comment of opportunity.comments) {
      assert.ok(comment.text.length <= 160, opportunity.id);
      assert.doesNotMatch(comment.text, /https?:\/\/|www\.|#[\p{L}\p{N}_-]+/iu, opportunity.id);
      assert.doesNotMatch(comment.text, /\b(?:follow|subscribe|link in bio|check out)\b/iu, opportunity.id);
    }
    if (opportunity.status === "surging") {
      assert.equal(hasCommentOpportunityAccelerationEvidence(opportunity), true, opportunity.id);
    }
  }
});

test("a single large counter is hot, never acceleration evidence", () => {
  const opportunity = structuredClone(feed.opportunities[0]);
  opportunity.observations = [opportunity.observations.at(-1)];
  opportunity.status = "hot";
  assert.equal(opportunity.observations.length, 1);
  assert.equal(hasCommentOpportunityAccelerationEvidence(opportunity), false);
  opportunity.status = "surging";
  const snapshot = structuredClone(feed);
  snapshot.opportunities[0] = opportunity;
  assert.throws(() => assertCommentOpportunityFeed(snapshot), /Accélération non prouvée/i);
});

test("ranking combines editorial fit and freshness without raw cross-platform counters", () => {
  const ranked = rankCommentOpportunities(feed.opportunities, feed.capturedAt);
  for (let index = 1; index < ranked.length; index += 1) {
    assert.ok(
      commentOpportunityRankScore(ranked[index - 1], feed.capturedAt) >=
        commentOpportunityRankScore(ranked[index], feed.capturedAt),
    );
  }
  const fresh = {
    ...structuredClone(feed.opportunities[0]),
    id: "fresh-reference",
    priorityScore: 90,
    publishedAt: feed.capturedAt,
    status: "hot",
  };
  const stale = {
    ...structuredClone(feed.opportunities[1]),
    id: "stale-reference",
    priorityScore: 100,
    publishedAt: "2026-07-01T00:00:00Z",
    status: "hot",
  };
  assert.equal(
    rankCommentOpportunities([stale, fresh], feed.capturedAt)[0].id,
    fresh.id,
    "a fresh strong-fit reaction should outrank an old isolated viral post",
  );
});
