import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mergeWorkspaceWithPublicHistory } from "../lib/public-history.ts";
import { matchesSocialFormatFilter } from "../lib/social-formats.ts";

async function snapshot() {
  return JSON.parse(
    await readFile(new URL("../data/public-history.json", import.meta.url), "utf8"),
  );
}

test("the versioned YouTube history contains only Shorts and Community posts", async () => {
  const history = await snapshot();
  const youtube = history.posts.filter((post) => post.platform === "youtube");
  const formats = new Set(youtube.map((post) => post.format));

  assert.ok(youtube.length > 0);
  assert.deepEqual(
    [...formats].sort(),
    ["community_image", "community_poll", "community_text", "short"],
  );
  assert.ok(youtube.every((post) => !post.url.includes("/watch")));
  assert.ok(youtube.every((post) => post.format !== "video"));
  assert.ok(youtube.every((post) => post.format !== "livestream"));
});

test("the workspace boundary also removes stale long videos and livestreams", async () => {
  const history = await snapshot();
  const stale = {
    platform: "youtube",
    external_post_id: "long-stale",
    url: "https://www.youtube.com/watch?v=long-stale",
    title: "A stale long video",
    text: "",
    format: "video",
  };
  const liveShort = {
    platform: "youtube",
    external_post_id: "short-live",
    url: "https://www.youtube.com/shorts/short-live",
    title: "A current Short",
    text: "",
    format: "short",
  };

  const workspace = mergeWorkspaceWithPublicHistory(
    { generatedAt: history.generatedAt, posts: [stale, liveShort] },
    history,
  );

  assert.equal(
    workspace.posts.some((post) => post.external_post_id === "long-stale"),
    false,
  );
  assert.equal(
    workspace.posts.some((post) => post.external_post_id === "short-live"),
    true,
  );
  assert.match(workspace.notice, /vidéos longues et lives sont exclus/i);
});

test("poll vote totals are exposed as a first-class UI metric", async () => {
  const history = await snapshot();
  const workspace = mergeWorkspaceWithPublicHistory(null, history);
  const polls = workspace.posts.filter(
    (post) => post.platform === "youtube" && post.format === "community_poll",
  );

  assert.ok(polls.length > 0);
  assert.ok(polls.some((post) => Number.isFinite(post.poll_votes)));
});

test("the YouTube Community filter contains image posts only", async () => {
  const history = await snapshot();
  const youtube = history.posts.filter((post) => post.platform === "youtube");
  const communityImages = youtube.filter((post) =>
    matchesSocialFormatFilter(post, "community"),
  );

  assert.equal(communityImages.length, 94);
  assert.ok(communityImages.every((post) => post.format === "community_image"));
  assert.ok(
    youtube
      .filter((post) => post.format === "community_text")
      .every((post) => !matchesSocialFormatFilter(post, "community")),
  );
  assert.ok(
    youtube
      .filter((post) => post.format === "community_poll")
      .every((post) => !matchesSocialFormatFilter(post, "community")),
  );
});
