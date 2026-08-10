import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SocialOS, type WorkspacePayload } from "../app/SocialOS";
import "../app/globals.css";
import publicHistorySummaryJson from "../data/public-history-summary.json";
import trendFeedJson from "../data/trends/feed.json";
import {
  mergeWorkspaceWithPublicHistory,
  type PublicHistorySnapshot,
  type PublicHistorySummary,
} from "../lib/public-history";
import type { SocialPlatform } from "../lib/social-scanner";
import {
  assertSocialTrendFeed,
  type SocialTrendFeed,
} from "../lib/social-trends";

const PLATFORM_ORDER: SocialPlatform[] = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
];
const publicHistorySummary = publicHistorySummaryJson as PublicHistorySummary;
const fallbackTrendFeed = assertSocialTrendFeed(
  trendFeedJson as SocialTrendFeed,
);
const RAW_TREND_FEED_URL =
  "https://raw.githubusercontent.com/dim75017/lofi-social-radar/main/data/trends/feed.json";
const emptySnapshot: PublicHistorySnapshot = {
  generatedAt: publicHistorySummary.generatedAt,
  coverage: publicHistorySummary.coverage,
  posts: [],
};
const initialWorkspace = mergeWorkspaceWithPublicHistory(
  null,
  emptySnapshot,
  "public-snapshot",
  {
    editorialAnalysis: "none",
    accountCounts: publicHistorySummary.platformCounts,
  },
);
const dataBaseUrl = `${import.meta.env.BASE_URL}data`;
const snapshotVersion = encodeURIComponent(
  `${publicHistorySummary.generatedAt}:${publicHistorySummary.totalPostCount}:${JSON.stringify(publicHistorySummary.formatCounts)}`,
);

function PublicPreview() {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [trendFeed, setTrendFeed] = useState(fallbackTrendFeed);
  const [pendingPlatforms, setPendingPlatforms] = useState<SocialPlatform[]>([
    ...PLATFORM_ORDER,
  ]);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetch(`${RAW_TREND_FEED_URL}?v=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Actualisation Trends impossible (${response.status}).`);
        }
        return assertSocialTrendFeed(
          (await response.json()) as SocialTrendFeed,
        );
      })
      .then((snapshot) => {
        if (!active) return;
        const incomingAt = Date.parse(snapshot.capturedAt);
        if (!Number.isFinite(incomingAt)) return;
        setTrendFeed((current) => {
          const currentAt = Date.parse(current.capturedAt);
          return !Number.isFinite(currentAt) || incomingAt >= currentAt
            ? snapshot
            : current;
        });
      })
      .catch(() => {
        // Le snapshot embarqué reste disponible hors ligne ou si GitHub est indisponible.
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const snapshots = new Map<SocialPlatform, PublicHistorySnapshot>();

    const publishLoadedSnapshots = () => {
      if (!active) return;
      const snapshot: PublicHistorySnapshot = {
        generatedAt: publicHistorySummary.generatedAt,
        coverage: publicHistorySummary.coverage,
        posts: PLATFORM_ORDER.flatMap(
          (platform) => snapshots.get(platform)?.posts ?? [],
        ),
      };
      setWorkspace(
        mergeWorkspaceWithPublicHistory(null, snapshot, "public-snapshot", {
          editorialAnalysis: "leaders",
          accountCounts: publicHistorySummary.platformCounts,
        }),
      );
    };

    const loadPlatform = async (platform: SocialPlatform) => {
      const snapshot = await fetchSnapshot(
        `public-history-${platform}.json`,
        controller.signal,
      );
      if (snapshot.generatedAt !== publicHistorySummary.generatedAt) {
        throw new Error(`Version ${platform} incohérente.`);
      }
      snapshots.set(platform, snapshot);
      publishLoadedSnapshots();
      if (active) {
        setPendingPlatforms((current) =>
          current.filter((candidate) => candidate !== platform),
        );
      }
    };

    void Promise.allSettled(PLATFORM_ORDER.map(loadPlatform)).then(
      async (results) => {
        if (!active || results.every((result) => result.status === "fulfilled")) {
          return;
        }
        try {
          const snapshot = await fetchSnapshot(
            "public-history.json",
            controller.signal,
          );
          if (!active) return;
          setWorkspace(
            mergeWorkspaceWithPublicHistory(null, snapshot, "public-snapshot", {
              editorialAnalysis: "leaders",
              accountCounts: publicHistorySummary.platformCounts,
            }),
          );
          setPendingPlatforms([]);
        } catch {
          if (!active || controller.signal.aborted) return;
          setPendingPlatforms([]);
          setHistoryError(
            "Les compteurs sont à jour, mais les fiches détaillées n’ont pas pu être chargées.",
          );
        }
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <SocialOS
      initialWorkspace={workspace as WorkspacePayload}
      initialTrendFeed={trendFeed}
      previewMode
      publicCounts={publicHistorySummary.platformCounts}
      publicFormatCounts={publicHistorySummary.formatCounts}
      pendingPlatforms={pendingPlatforms}
      historyError={historyError}
    />
  );
}

async function fetchSnapshot(
  filename: string,
  signal: AbortSignal,
): Promise<PublicHistorySnapshot> {
  const response = await fetch(
    `${dataBaseUrl}/${filename}?v=${snapshotVersion}`,
    { cache: "force-cache", signal },
  );
  if (!response.ok) throw new Error(`Chargement impossible (${response.status}).`);
  return (await response.json()) as PublicHistorySnapshot;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PublicPreview />
  </StrictMode>,
);
