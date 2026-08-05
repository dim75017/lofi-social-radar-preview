import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SocialOS, type WorkspacePayload } from "../app/SocialOS";
import "../app/globals.css";
import publicHistory from "../data/public-history.json";
import recentPublic from "../data/recent-public.json";
import {
  mergeWorkspaceWithPublicHistory,
  type PublicHistorySnapshot,
} from "../lib/public-history";

const initialWorkspace = mergeWorkspaceWithPublicHistory(
  recentPublic,
  publicHistory as PublicHistorySnapshot,
  "public-snapshot",
);

const LIVE_PUBLIC_HISTORY_URL =
  "https://raw.githubusercontent.com/dim75017/lofi-social-radar/main/data/public-history.json";

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

  return <SocialOS initialWorkspace={workspace as WorkspacePayload} previewMode />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PublicPreview />
  </StrictMode>,
);
