import type { Metadata } from "next";
import audienceHistoryJson from "../data/audience-history.json";
import commentOpportunityFeedJson from "../data/comment-opportunities/feed.json";
import {
  assertAudienceHistory,
  type AudienceHistory,
} from "../lib/audience-metrics";
import {
  assertCommentOpportunityFeed,
  type CommentOpportunityFeed,
} from "../lib/comment-opportunities";
import { SocialOS } from "./SocialOS";

export const metadata: Metadata = {
  title: { absolute: "Lofi Social Radar" },
  description:
    "Social & Community Intelligence OS · de la tendance détectée à la décision éditoriale.",
};

export default function Home() {
  return (
    <SocialOS
      initialCommentOpportunityFeed={assertCommentOpportunityFeed(
        commentOpportunityFeedJson as CommentOpportunityFeed,
      )}
      initialAudienceHistory={assertAudienceHistory(
        audienceHistoryJson as AudienceHistory,
      )}
    />
  );
}
