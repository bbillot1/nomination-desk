import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { Desk } from "./pages/Desk";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

createRoot(root).render(
  <StrictMode>
    <Desk />
  </StrictMode>,
);
