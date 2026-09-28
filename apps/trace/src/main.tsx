import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeTheme } from "./theme";
import { initializePreferences } from "./preferences";
import { initializeReviewWorkspace } from "./review-workspace";
import "./styles.css";
import "./workspace.css";
import "./components/review-header.css";
initializeTheme();
initializePreferences();
initializeReviewWorkspace();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
