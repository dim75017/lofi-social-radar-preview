import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLofiCommentPrompt,
  fallbackLofiComments,
  LOFI_COMMENT_ARCHETYPES,
  LOFI_VOICE_HALL_OF_FAME,
  parseLofiVoiceResponse,
  requestLofiComments,
  validateLofiComment,
} from "../lib/lofi-voice.ts";
import { isPromotionalComment } from "../lib/comment-opportunities.ts";

const sampleOpportunity = {
  platform: "youtube",
  category: "gaming",
  author: "Rockstar Games",
  title: "Grand Theft Auto VI Trailer 3",
  caption: "Coming May 2027.",
  momentTier: "s",
  metrics: { views: 12_000_000, likes: null, comments: null, shares: null },
  velocity: {
    metric: "views",
    perHour: 1_200_000,
    windowHours: 0.5,
    fromCapturedAt: "2026-08-13T10:00:00Z",
    toCapturedAt: "2026-08-13T10:30:00Z",
  },
  publishedAt: "2026-08-13T10:00:00Z",
};

test("the guard refuses everything a brand account must never post", () => {
  assert.equal(validateLofiComment("ok i will put my pen down for this one").ok, true);
  assert.equal(validateLofiComment("").ok, false);
  assert.equal(validateLofiComment(" leading space").ok, false);
  assert.equal(validateLofiComment("two\nlines").ok, false);
  assert.equal(validateLofiComment("go check out our playlist").ok, false);
  assert.equal(validateLofiComment("listen here https://example.com").ok, false);
  assert.equal(validateLofiComment("nice #lofi").ok, false);
  assert.equal(validateLofiComment("rip to a legend").ok, false);
  assert.equal(validateLofiComment("🔥🔥 this goes hard").ok, false);
  assert.equal(validateLofiComment("as an ai i loved this").ok, false);
  assert.equal(validateLofiComment("a".repeat(161)).ok, false);
  assert.equal(validateLofiComment("a".repeat(160)).ok, true);
});

test("the reference line that worked still passes its own guard", () => {
  assert.ok(LOFI_VOICE_HALL_OF_FAME.length > 0);
  for (const entry of LOFI_VOICE_HALL_OF_FAME) {
    assert.equal(validateLofiComment(entry.comment).ok, true, entry.comment);
  }
  for (const archetype of LOFI_COMMENT_ARCHETYPES) {
    assert.equal(validateLofiComment(archetype.example).ok, true, archetype.example);
  }
});

test("the prompt carries the canon, the archetypes and the measured facts", () => {
  const prompt = buildLofiCommentPrompt(sampleOpportunity);
  assert.match(prompt.system, /Pocky/u);
  assert.match(prompt.system, /put my pen down/u);
  assert.match(prompt.system, /pen-down/u);
  assert.match(prompt.system, /160 caractères maximum/u);
  assert.match(prompt.user, /Rockstar Games/u);
  assert.match(prompt.user, /Grand Theft Auto VI Trailer 3/u);
  assert.match(prompt.user, /1\s?200\s?000 views par heure/u);
  assert.match(prompt.user, /moment culturel majeur/u);
});

test("a triplet is accepted only when all three tones survive the guard", () => {
  const good = parseLofiVoiceResponse(`{"usable":true,"comments":[
    {"tone":"funny","archetype":"pen-down","text":"ok i will put my pen down for this one"},
    {"tone":"smart","archetype":"the-loop","text":"i was already at this desk when the last one came out"},
    {"tone":"complice","archetype":"deadline","text":"nobody in this comment section is working tomorrow"}
  ]}`);
  assert.equal(good.usable, true);
  assert.deepEqual(good.comments.map((comment) => comment.tone), ["funny", "smart", "complice"]);
  assert.deepEqual(good.comments.map((comment) => comment.label), ["Drôle", "Smart", "Complice"]);

  const oneBad = parseLofiVoiceResponse(`{"usable":true,"comments":[
    {"tone":"funny","text":"ok i will put my pen down for this one"},
    {"tone":"smart","text":"go follow them right now"},
    {"tone":"complice","text":"see you in the replies"}
  ]}`);
  assert.equal(oneBad.usable, false, "one unusable line invalidates the whole triplet");
  assert.match(oneBad.reason, /smart/u);

  assert.equal(parseLofiVoiceResponse("not json at all").usable, false);
  assert.equal(parseLofiVoiceResponse(`{"usable":false,"reason":"deuil"}`).usable, false);
  assert.equal(
    parseLofiVoiceResponse(`{"usable":true,"comments":[
      {"tone":"funny","text":"same line"},
      {"tone":"smart","text":"same line"},
      {"tone":"complice","text":"another line"}
    ]}`).usable,
    false,
    "three proposals that are two proposals are refused",
  );
});

test("the model answer survives the prose models like to wrap JSON in", () => {
  const parsed = parseLofiVoiceResponse(`Voici les propositions :
\`\`\`json
{"usable":true,"comments":[
  {"tone":"funny","text":"new phone, same three apps"},
  {"tone":"smart","text":"the interesting part is always what they stopped shipping"},
  {"tone":"complice","text":"the annual ritual, on time as always"}
]}
\`\`\``);
  assert.equal(parsed.usable, true);
});

test("fallback lines are stable per card, distinct per tone and never promotional", () => {
  const first = fallbackLofiComments("yt-abc-123456");
  const again = fallbackLofiComments("yt-abc-123456");
  assert.deepEqual(first, again, "the same card must not shuffle its placeholder on every run");
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map((comment) => comment.text)).size, 3);
  for (const comment of first) {
    assert.equal(validateLofiComment(comment.text).ok, true, comment.text);
    assert.equal(isPromotionalComment(comment.text), false, comment.text);
  }
  const other = fallbackLofiComments("yt-zzz-999999");
  assert.notDeepEqual(
    first.map((comment) => comment.text),
    other.map((comment) => comment.text),
    "two different cards should not always get the same placeholder",
  );
});

test("an unavailable voice engine degrades instead of throwing", async () => {
  const result = await requestLofiComments(sampleOpportunity, {
    apiKey: "test-key",
    fetchImpl: async () => new Response("nope", { status: 529 }),
  });
  assert.equal(result.usable, false);
  assert.match(result.reason, /529/u);
});

test("the canon block is sent as a cacheable prefix, once per run", async () => {
  let captured = null;
  await requestLofiComments(sampleOpportunity, {
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          content: [{
            type: "text",
            text: `{"usable":true,"comments":[
              {"tone":"funny","text":"ok i will put my pen down for this one"},
              {"tone":"smart","text":"eight years at this desk and this is the interruption"},
              {"tone":"complice","text":"see you all back here in 2027"}
            ]}`,
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(captured.system[0].cache_control.type, "ephemeral");
  assert.equal(captured.messages.length, 1);
  assert.ok(captured.max_tokens > 0);
});
