
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { preloadManifold } from "./lib/manifold/runtime";
import { preloadOpenCV } from "./lib/opencv";

// Render app immediately
createRoot(document.getElementById("root")!).render(<App />);

// Start preloading OpenCV in background (non-blocking)
console.log("[App] Starting OpenCV preload in background...");
preloadOpenCV()
  .then(() => console.log("[App] OpenCV preloaded successfully"))
  .catch((error) => console.error("[App] OpenCV preload failed:", error));

// Warm the geometry kernel too — it backs outline offsetting and STL export.
preloadManifold();
