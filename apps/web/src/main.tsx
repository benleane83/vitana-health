import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import "./styles.css";
import "./styles/a11y.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="Vitana Health">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

