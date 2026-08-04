import assert from "node:assert/strict";
import test from "node:test";

import { generateSocialIdeas } from "../lib/social-ideas.ts";

const NOW = "2026-08-04T12:00:00.000Z";

function post(overrides) {
  return {
    platform: "youtube",
    externalId: "post",
    url: "https://example.test/post",
    title: "Post",
    text: "",
    format: "short",
    thumbnailUrl: null,
    publishedAt: "2026-08-02T12:00:00.000Z",
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    raw: {},
    ...overrides,
  };
}

test("generates deterministic ideas with cited seeds and a native adaptation for every platform", () => {
  const posts = [
    post({
      platform: "youtube",
      externalId: "yt-shared",
      url: "https://youtube.test/yt-shared",
      title: "be ready, I am coming for you all",
      views: 100_000,
      likes: 8_000,
    }),
    post({
      platform: "youtube",
      externalId: "yt-other",
      title: "late night focus beats",
      views: 10_000,
      likes: 200,
    }),
    post({
      platform: "tiktok",
      externalId: "tt-shared",
      url: "https://tiktok.test/tt-shared",
      title: "be ready, I am coming for you all",
      format: "video",
      views: 30_000,
      likes: 4_000,
    }),
    post({
      platform: "tiktok",
      externalId: "tt-other",
      title: "quiet study desk",
      format: "video",
      views: 1_000,
      likes: 20,
    }),
  ];

  const first = generateSocialIdeas(posts, { now: NOW });
  const second = generateSocialIdeas([...posts].reverse(), { now: NOW });

  assert.deepEqual(first, second);
  assert.equal(first.ideas[0].pattern, "cross_platform_echo");
  assert.deepEqual(
    first.ideas[0].seedPosts.map((seed) => seed.platform),
    ["youtube", "tiktok"],
  );
  assert.deepEqual(Object.keys(first.ideas[0].platformAdaptations).sort(), [
    "instagram",
    "tiktok",
    "x",
    "youtube",
  ]);
  assert.match(first.ideas[0].observedSignal.summary, /YouTube.*TikTok|TikTok.*YouTube/);
  assert.ok(first.ideas[0].observedSignal.evidence.every((item) => /https:\/\//.test(item)));
  assert.doesNotMatch(
    [
      first.ideas[0].observedSignal.summary,
      ...first.ideas[0].observedSignal.evidence,
      first.ideas[0].confidenceRationale,
    ].join(" "),
    /\/100|\b(?:score|rang|percentile|likes?|vues?)\b/i,
  );
  assert.ok(first.ideas[0].hook.length > 10);
  assert.ok(first.ideas[0].proposedFormat.length > 20);
  assert.match(
    first.ideas[0].platformAdaptations.youtube.format,
    /Short.*Communauté/i,
  );
  assert.doesNotMatch(
    `${first.ideas[0].platformAdaptations.youtube.format} ${first.ideas[0].platformAdaptations.youtube.execution}`,
    /vidéo longue|live\s*stream/i,
  );
  assert.match(first.ideas[0].platformAdaptations.instagram.format, /Reel.*statique/i);
});

test("labels every proposal as non-causal and bans generated-AI visuals", () => {
  const plan = generateSocialIdeas(
    [
      post({ externalId: "high", title: "late night study beats", views: 100_000 }),
      post({ externalId: "low", title: "other upload", views: 1_000 }),
    ],
    { now: NOW },
  );

  assert.ok(plan.ideas.length > 0);
  for (const idea of plan.ideas) {
    assert.equal(idea.assetPolicy, "official-assets-only");
    assert.ok(idea.limits.some((limit) => /ne prouve pas.*cause/i.test(limit)));
    assert.ok(idea.limits.some((limit) => /Aucun visuel généré par IA/i.test(limit)));
    assert.ok(idea.confidenceScore >= 1 && idea.confidenceScore <= 95);
    assert.match(idea.confidenceRationale, /prioriser un test/i);
  }
});

test("does not invent ideas when no public metric can rank a seed", () => {
  const plan = generateSocialIdeas(
    [
      post({
        platform: "instagram",
        externalId: "unscored",
        title: "A post with unavailable metrics",
      }),
    ],
    { now: NOW },
  );

  assert.equal(plan.eligiblePostCount, 0);
  assert.equal(plan.winnerCount, 0);
  assert.deepEqual(plan.ideas, []);
});

test("keeps a single-platform, low-cohort idea at low confidence and exposes the limitation", () => {
  const plan = generateSocialIdeas(
    [
      post({
        externalId: "only",
        title: "What is your focus mode?",
        views: 12_000,
      }),
    ],
    { now: NOW },
  );
  const idea = plan.ideas[0];

  assert.equal(idea.confidence, "low");
  assert.ok(idea.seedPosts.every((seed) => seed.platform === "youtube"));
  assert.ok(idea.limits.some((limit) => /uniquement sur YouTube/i.test(limit)));
  assert.ok(idea.limits.some((limit) => /petite cohorte|peu de métriques/i.test(limit)));
});

test("uses a stable data-derived reference time when now is omitted", () => {
  const posts = [
    post({ externalId: "top", views: 2_000 }),
    post({ externalId: "other", views: 1_000 }),
  ];

  const first = generateSocialIdeas(posts);
  const second = generateSocialIdeas(posts);

  assert.equal(first.generatedAt, "2026-08-03T12:00:00.000Z");
  assert.deepEqual(first, second);
});

test("selects winners by the public metric inside each exact platform-format cohort", () => {
  const plan = generateSocialIdeas(
    [
      post({
        externalId: "short-views-only",
        title: "Lofi Girl realizes she is being recorded",
        views: 2_000_000,
        likes: 20,
      }),
      post({
        externalId: "short-likes",
        title: "girl i just graduado",
        views: 20_000,
        likes: 900,
      }),
      post({
        externalId: "text-low",
        title: "today feels productive",
        format: "community_text",
        likes: 80,
      }),
      post({
        externalId: "text-likes",
        title: 'not to flex but i moved one task from "to do" to "done"',
        format: "community_text",
        likes: 600,
      }),
      post({
        externalId: "poll-low",
        title: "What is your favorite drink?",
        format: "community_poll",
        raw: { pollVotes: 4_000, pollChoices: ["Coffee", "Tea"] },
      }),
      post({
        externalId: "poll-votes",
        title: "Who would you like the next release to be about?",
        format: "community_poll",
        raw: {
          pollVotes: 20_000,
          pollChoices: ["Jade", "Lofi Boy", "Emma", "Tiago"],
        },
      }),
    ],
    { now: NOW, maxIdeas: 10, winnersPerPlatform: 1 },
  );

  const seedIds = new Set(
    plan.ideas.flatMap((idea) =>
      idea.seedPosts.map((seed) => seed.externalId),
    ),
  );
  assert.equal(plan.eligiblePostCount, 6);
  assert.equal(plan.winnerCount, 3);
  assert.deepEqual([...seedIds].sort(), [
    "poll-votes",
    "short-likes",
    "text-likes",
  ]);
});

test("maps editorial patterns from the new analysis without hashtag or study false positives", () => {
  const plan = generateSocialIdeas(
    [
      post({
        platform: "tiktok",
        externalId: "graduado",
        title: "girl i just graduado 🎓 #lofigirl #studying #fyp",
        format: "video",
        likes: 900,
      }),
      post({
        platform: "tiktok",
        externalId: "generic-study",
        title: "quiet study desk #lofigirl #studying",
        format: "video",
        likes: 20,
      }),
    ],
    { now: NOW, winnersPerPlatform: 1 },
  );

  assert.equal(plan.ideas[0].pattern, "relatable_humour");
  assert.doesNotMatch(plan.ideas[0].observedSignal.summary, /musique.*usage/i);
});
