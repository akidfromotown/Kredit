import { useEffect, useState } from "react";

/**
 * Minimal hash router using plain "#name" hashes (letters, digits, hyphens) so links survive
 * hosts that only pass simple fragments. "#applications-BIZ-10001" → ["applications", "BIZ-10001"].
 */
export function parseHash(hash: string): string[] {
  const h = hash.replace(/^#\/?/, "");
  if (!h) return ["portfolio"];
  if (h.includes("/")) return h.split("/").filter(Boolean);
  const i = h.indexOf("-");
  return i < 0 ? [h] : [h.slice(0, i), h.slice(i + 1)];
}

export function useRoute(): string[] {
  const [r, setR] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => { setR(parseHash(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const go = (path: string) => { window.location.hash = path.replace("/", "-"); };
