import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SocialOS, type WorkspacePayload } from "../app/SocialOS";
import "../app/globals.css";
import publicHistory from "../data/public-history.json";
import recentPublic from "../data/recent-public.json";
import {
  mergeWorkspaceWithPublicHistory,
  type PublicHistorySnapshot,
} from "../lib/public-history";

const workspace = mergeWorkspaceWithPublicHistory(
  recentPublic,
  publicHistory as PublicHistorySnapshot,
  "public-snapshot",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SocialOS initialWorkspace={workspace as WorkspacePayload} previewMode />
  </StrictMode>,
);
