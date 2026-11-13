import { useEffect, useState } from "react";

/** Minimal hash router so the app works as a single static file. */
export function useRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, "") || "portfolio").split("/").filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const go = (path: string) => { window.location.hash = "/" + path; };
