import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Łączy klasy Tailwind z deduplikacją, aby widoki nie musiały ręcznie rozstrzygać kolizji. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}