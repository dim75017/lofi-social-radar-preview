import assert from "node:assert/strict";
import test from "node:test";

import {
  SOCIAL_DURATION_FILTERS,
  hasKnownSocialPublishedDate,
  matchesSocialDuration,
} from "../lib/social-duration.ts";

const reference = "2026-08-04T12:00:00.000Z";

test("defaults to an explicit All time option", () => {
  assert.equal(SOCIAL_DURATION_FILTERS[0].key, "all");
  assert.equal(SOCIAL_DURATION_FILTERS[0].label, "All time");
  assert.equal(
    matchesSocialDuration({ published_at: null }, "all", reference),
    true,
  );
});

test("filters relative to the snapshot date with inclusive boundaries", () => {
  assert.equal(
    matchesSocialDuration(
      { published_at: "2026-07-05T12:00:00.000Z" },
      "30d",
      reference,
    ),
    true,
  );
  assert.equal(
    matchesSocialDuration(
      { published_at: "2026-07-05T11:59:59.000Z" },
      "30d",
      reference,
    ),
    false,
  );
  assert.equal(
    matchesSocialDuration(
      { published_at: "2026-08-05T12:00:00.000Z" },
      "30d",
      reference,
    ),
    false,
  );
});

test("excludes unknown publication dates only from finite periods", () => {
  const unknown = { published_at: null };
  assert.equal(hasKnownSocialPublishedDate(unknown), false);
  assert.equal(matchesSocialDuration(unknown, "7d", reference), false);
  assert.equal(matchesSocialDuration(unknown, "all", reference), true);
  assert.equal(
    hasKnownSocialPublishedDate({ publishedAt: "2026-08-01T00:00:00Z" }),
    true,
  );
});
