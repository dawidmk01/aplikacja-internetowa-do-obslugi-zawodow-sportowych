// frontend/src/main.tsx
// Plik inicjuje aplikację React i montuje główny komponent w elemencie root.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Brak elementu #root w index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);