import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SocialOS, type WorkspacePayload } from "../app/SocialOS";
import "../app/globals.css";
import recentPublic from "../data/recent-public.json";
import {
  mergeWorkspaceWithPublicHistory,
  type PublicHistorySnapshot,
} from "../lib/public-history";

const initialWorkspace = mergeWorkspaceWithPublicHistory(
  recentPublic,
  {
    generatedAt: recentPublic.generatedAt,
    coverage: [],
    posts: [],
  } satisfies PublicHistorySnapshot,
  "public-snapshot",
);

const LIVE_PUBLIC_HISTORY_URL =
  "https://dim75017.github.io/lofi-social-radar-preview/data/public-history.json";

function PublicPreview() {
  const [workspace, setWorkspace] = useState(initialWorkspace);

  useEffect(() => {
    let active = true;
    void fetch(LIVE_PUBLIC_HISTORY_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as PublicHistorySnapshot;
      })
      .then((history) => {
        if (!active || !history) return;
        setWorkspace(
          mergeWorkspaceWithPublicHistory(recentPublic, history, "public-snapshot"),
        );
      })
      .catch(() => {
        // The embedded snapshot keeps the public preview usable offline.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <SocialOS
      key={`${workspace.generatedAt}:${workspace.posts.length}`}
      initialWorkspace={workspace as WorkspacePayload}
      previewMode
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PublicPreview />
  </StrictMode>,
);
