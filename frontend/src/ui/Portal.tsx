// frontend/src/ui/Portal.tsx
// Komponent renderuje zawartość poza drzewem DOM w celu kontroli warstw.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  children: ReactNode;
};

// Portal upraszcza zarządzanie warstwami i kontekstem z-index.
export function Portal({ children }: Props) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}