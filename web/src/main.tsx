import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installViewportFix } from "./lib/viewport";
import "./styles.css";

installViewportFix();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
