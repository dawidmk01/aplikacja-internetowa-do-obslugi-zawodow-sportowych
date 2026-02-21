import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  children: ReactNode;
};

/** Portal przenosi warstwy (modal, dropdown) poza kontekst overflow i stacking bieżącego widoku. */
export function Portal({ children }: Props) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}