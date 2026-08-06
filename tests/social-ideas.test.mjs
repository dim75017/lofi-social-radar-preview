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
  assert.equal(first.ideas[0].primaryPlatform, "youtube");
  assert.ok(first.ideas[0].potentialScore >= 1 && first.ideas[0].potentialScore <= 100);
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

test("labels every proposal as non-causal and bans generated-AI visuals and music", () => {
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
    assert.ok(
      idea.limits.some((limit) => /Aucun visuel ni aucune musique générés par IA/i.test(limit)),
    );
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

test("builds a balanced deterministic portfolio of 50 genuinely distinct platform ideas", () => {
  const platforms = ["youtube", "instagram", "tiktok", "x"];
  const formats = {
    youtube: "short",
    instagram: "reel",
    tiktok: "video",
    x: "text",
  };
  const posts = platforms.flatMap((platform, platformIndex) =>
    Array.from({ length: 3 }, (_, index) =>
      post({
        platform,
        externalId: `${platform}-${index}`,
        url: `https://${platform}.test/${platform}-${index}`,
        title: `${platform} original winning concept ${index}`,
        format: formats[platform],
        likes: 10_000 - platformIndex * 500 - index * 100,
        views: 100_000 - platformIndex * 5_000 - index * 1_000,
      }),
    ),
  );

  const first = generateSocialIdeas(posts, {
    now: NOW,
    maxIdeas: 50,
    winnersPerPlatform: 3,
  });
  const second = generateSocialIdeas([...posts].reverse(), {
    now: NOW,
    maxIdeas: 50,
    winnersPerPlatform: 3,
  });

  assert.deepEqual(first, second);
  assert.equal(first.ideas.length, 50);
  assert.equal(new Set(first.ideas.map((idea) => idea.id)).size, 50);
  assert.equal(
    new Set(
      first.ideas.map(
        (idea) => `${idea.primaryPlatform}:${idea.title}:${idea.hook}`,
      ),
    ).size,
    50,
  );
  assert.deepEqual(
    Object.fromEntries(
      platforms.map((platform) => [
        platform,
        first.ideas.filter((idea) => idea.primaryPlatform === platform).length,
      ]),
    ),
    { youtube: 13, instagram: 13, tiktok: 12, x: 12 },
  );
  for (const platform of platforms) {
    assert.deepEqual(
      first.ideas
        .filter((idea) => idea.primaryPlatform === platform)
        .map((idea) => idea.platformRank)
        .sort((left, right) => left - right),
      Array.from(
        { length: first.ideas.filter((idea) => idea.primaryPlatform === platform).length },
        (_, index) => index + 1,
      ),
    );
  }
  assert.ok(
    first.ideas.every(
      (idea) =>
        platforms.includes(idea.primaryPlatform) &&
        idea.potentialScore >= 1 &&
        idea.potentialScore <= 100 &&
      Object.keys(idea.platformAdaptations).length === 4,
    ),
  );
  const exploratory = first.ideas.filter((idea) =>
    idea.limits.some((limit) => /sans précédent direct/i.test(limit)),
  );
  assert.ok(exploratory.length > 0);
  assert.ok(exploratory.every((idea) => idea.confidenceScore <= 45));
  assert.ok(
    exploratory.every((idea) =>
      /Aucun post gagnant/i.test(idea.observedSignal.summary) &&
      !/partagent? le ressort/i.test(idea.observedSignal.summary),
    ),
  );
});

test("never uses comments as performance seeds even when their public counts are highest", () => {
  const plan = generateSocialIdeas(
    [
      post({
        externalId: "youtube-comment",
        format: "comment",
        title: "Creator comment",
        likes: 9_000_000,
        views: 90_000_000,
      }),
      post({
        platform: "instagram",
        externalId: "instagram-reply",
        format: "creator-comment",
        title: "Creator reply",
        likes: 8_000_000,
        views: 80_000_000,
      }),
      post({
        externalId: "youtube-short",
        format: "short",
        title: "A real Short seed",
        likes: 900,
        views: 9_000,
      }),
      post({
        platform: "instagram",
        externalId: "instagram-reel",
        format: "reel",
        title: "A real Reel seed",
        likes: 800,
        views: 8_000,
      }),
    ],
    { now: NOW, maxIdeas: 50 },
  );

  assert.equal(plan.eligiblePostCount, 2);
  assert.ok(plan.ideas.length > 0);
  assert.ok(
    plan.ideas
      .flatMap((idea) => idea.seedPosts)
      .every((seed) => !/[\-:](?:comment|reply)$/.test(seed.externalId)),
  );
  assert.deepEqual(
    [...new Set(plan.ideas.flatMap((idea) => idea.seedPosts.map((seed) => seed.externalId)))].sort(),
    ["instagram-reel", "youtube-short"],
  );
});
