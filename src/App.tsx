import { useEffect, useState } from "react";
import {
  Activity, BookOpen, ClipboardCheck, Database, FileText, Gauge, LayoutDashboard, Moon, ScrollText, Sun, UserPlus, Wallet,
} from "lucide-react";
import { useRoute } from "./router";
import { useStore } from "./store";
import { AS_OF } from "./engine/dates";
import { cn, d8 } from "./components/ui";
import PortfolioPage from "./pages/Portfolio";
import ApplicationsPage from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import OnboardingPage from "./pages/Onboarding";
import ReviewQueuePage from "./pages/ReviewQueue";
import PolicyPage from "./pages/Policy";
import MonitoringPage from "./pages/Monitoring";
import CollectionsPage from "./pages/Collections";
import AuditPage from "./pages/Audit";
import DataModelPage from "./pages/DataModel";

type NavItem = { id: string; label: string; icon: typeof LayoutDashboard };
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ id: "portfolio", label: "Portfolio", icon: LayoutDashboard }] },
  { title: "Originate", items: [
    { id: "onboarding", label: "New application", icon: UserPlus },
    { id: "applications", label: "Applications", icon: FileText },
    { id: "review", label: "Review queue", icon: ClipboardCheck },
  ] },
  { title: "Manage risk", items: [
    { id: "monitoring", label: "Monitoring", icon: Activity },
    { id: "collections", label: "Collections & loss", icon: Wallet },
  ] },
  { title: "Govern", items: [
    { id: "policy", label: "Credit policy", icon: BookOpen },
    { id: "audit", label: "Audit log", icon: ScrollText },
    { id: "data", label: "Data & model", icon: Database },
  ] },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

function useTheme() {
  const [dark, setDark] = useState(() => {
    const host = document.documentElement.getAttribute("data-theme");
    if (host === "dark" || host === "light") return host === "dark";
    try {
      const s = localStorage.getItem("kredit.theme.v2");
      if (s) return s === "dark";
    } catch { /* ignore */ }
    return true; // dark is the house look
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    if (document.documentElement.hasAttribute("data-theme")) document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("kredit.theme.v2", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const route = useRoute();
  const { world, mode } = useStore();
  const [dark, setDark] = useTheme();
  const pending = Object.values(world.decisions).filter((d) => d.engineOutcome === "REVIEW" && !d.human).length;
  const section = route[0];

  let page;
  switch (section) {
    case "applications": page = route[1] ? <ApplicationDetail id={route[1]} /> : <ApplicationsPage />; break;
    case "onboarding": page = <OnboardingPage />; break;
    case "review": page = <ReviewQueuePage />; break;
    case "policy": page = <PolicyPage />; break;
    case "monitoring": page = <MonitoringPage />; break;
    case "collections": page = <CollectionsPage />; break;
    case "audit": page = <AuditPage />; break;
    case "data": page = <DataModelPage />; break;
    default: page = <PortfolioPage />;
  }

  const isActive = (id: string) => section === id || (!NAV.some((x) => x.id === section) && id === "portfolio");
  const badge = (id: string) =>
    id === "review" && pending > 0 ? (
      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">{pending}<span className="h-1.5 w-1.5 rounded-full bg-signal" /></span>
    ) : null;

  return (
    <div className="min-h-screen">
      <div className="app-light" aria-hidden="true" />
      <div className="bg-primary text-primary-foreground dark:bg-foreground/[0.05] dark:text-muted-foreground text-[11px] text-center px-4 py-1.5">
        Demo · fictional US small-business lender · synthetic data only · no real customers or lending
      </div>
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b">
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">
          <a href="#portfolio" className="font-semibold tracking-tight text-lg">Kredit™</a>
          <span className="hidden sm:inline text-xs text-muted-foreground">Credit risk platform</span>
          <div className="ml-auto flex items-center gap-3">
            <span title={mode === "backend" ? "Reading from Supabase; writes go through the kredit-api function" : "No backend configured; data lives in this browser"} className={cn("hidden sm:inline-flex items-center gap-1.5 text-[11px] rounded-full px-2 py-0.5", mode === "backend" ? "bg-gain/15 text-gain" : "bg-secondary text-muted-foreground")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "backend" ? "bg-gain" : "bg-muted-foreground")} />{mode === "backend" ? "Live database" : "Local demo"}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap"><Gauge className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />As of {d8(AS_OF)}</span>
            <button aria-label="Toggle theme" onClick={() => setDark(!dark)} className="h-8 w-8 grid place-items-center rounded-xl hover:bg-muted">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className="lg:hidden flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={cn("px-3 h-8 inline-flex items-center gap-1.5 rounded-xl text-sm whitespace-nowrap", isActive(n.id) ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
              {n.label}{badge(n.id)}
            </a>
          ))}
        </nav>
      </header>
      <div className="flex">
        <aside className="hidden lg:block w-64 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] p-3">
          <div className="panel rounded-2xl h-full flex flex-col py-4">
            <nav className="flex-1 overflow-y-auto">
              {NAV_GROUPS.map((g, gi) => (
                <div key={g.title} className={cn("px-3", gi > 0 && "mt-3 pt-3 border-t border-[hsl(var(--glass-line))] mx-3 px-0")}>
                  <div className="micro px-3 pb-1.5">{g.title}</div>
                  <div className="space-y-0.5">
                    {g.items.map((n) => {
                      const on = isActive(n.id);
                      return (
                        <a key={n.id} href={`#${n.id}`} aria-current={on ? "page" : undefined} className={cn("relative flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] transition-colors", on ? "bg-foreground/[0.07] text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]")}>
                          {on && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-signal" />}
                          <n.icon className="h-4 w-4" strokeWidth={1.75} />
                          <span>{n.label}</span>
                          {badge(n.id)}
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="mx-3 mt-3 pt-3 border-t border-[hsl(var(--glass-line))] flex items-center gap-3 px-3">
              <span className="grid place-items-center h-8 w-8 rounded-full border border-[hsl(var(--glass-line))] text-[11px] text-muted-foreground">CR</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">Credit risk</span>
                <span className="block text-[11px] text-muted-foreground">Demo workspace</span>
              </span>
            </div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 px-4 md:px-6 py-6 max-w-[1400px]">{page}</main>
      </div>
    </div>
  );
}
