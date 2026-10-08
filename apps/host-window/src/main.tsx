import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@intelligent-ui/renderer-react/styles.css";
import "./host.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
