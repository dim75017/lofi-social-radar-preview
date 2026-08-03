import type { Metadata } from "next";
import { SocialOS } from "./SocialOS";

export const metadata: Metadata = {
  title: { absolute: "Lofi Social Radar" },
  description:
    "Social & Community Intelligence OS · de la tendance détectée à la décision éditoriale.",
};

export default function Home() {
  return <SocialOS />;
}
