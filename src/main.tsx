import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { installWebMcpPolyfill } from "./webmcp/polyfill";
import "./styles.css";

// Before React mounts: use the browser's WebMCP when it has one, install the
// same-page fallback when it does not.
installWebMcpPolyfill();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
