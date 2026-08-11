import type { Metadata } from "next";
import audienceHistoryJson from "../data/audience-history.json";
import {
  assertAudienceHistory,
  type AudienceHistory,
} from "../lib/audience-metrics";
import { SocialOS } from "./SocialOS";

export const metadata: Metadata = {
  title: { absolute: "Lofi Social Radar" },
  description:
    "Social & Community Intelligence OS · de la tendance détectée à la décision éditoriale.",
};

export default function Home() {
  return (
    <SocialOS
      initialAudienceHistory={assertAudienceHistory(
        audienceHistoryJson as AudienceHistory,
      )}
    />
  );
}
