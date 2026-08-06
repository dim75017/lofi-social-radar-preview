import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SocialOS, type WorkspacePayload } from "../app/SocialOS";
import "../app/globals.css";
import publicHistorySummaryJson from "../data/public-history-summary.json";
import {
  mergeWorkspaceWithPublicHistory,
  type PublicHistorySnapshot,
  type PublicHistorySummary,
} from "../lib/public-history";
import type { SocialPlatform } from "../lib/social-scanner";

const PLATFORM_ORDER: SocialPlatform[] = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
];
const publicHistorySummary = publicHistorySummaryJson as PublicHistorySummary;
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
const snapshotVersion = encodeURIComponent(publicHistorySummary.generatedAt);

function PublicPreview() {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [pendingPlatforms, setPendingPlatforms] = useState<SocialPlatform[]>([
    ...PLATFORM_ORDER,
  ]);
  const [historyError, setHistoryError] = useState("");

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
