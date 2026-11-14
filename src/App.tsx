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
      const s = localStorage.getItem("kredit.theme");
      if (s) return s === "dark";
    } catch { /* ignore */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    if (document.documentElement.hasAttribute("data-theme")) document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("kredit.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
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
    id === "review" && pending > 0 ? <span className="ml-auto text-[10px] bg-warn/20 text-warn rounded-full px-1.5 py-px font-semibold tabular-nums">{pending}</span> : null;

  return (
    <div className="min-h-screen">
      <div className="app-backdrop" aria-hidden="true" />
      <div className="text-[11px] text-center px-4 py-1.5 text-muted-foreground">
        Demo · fictional US small-business lender · synthetic data only · no real customers or lending
      </div>
      <header className="sticky top-0 z-30 px-3 md:px-4 pb-2">
        <div className="glass rounded-[22px] flex items-center gap-3 px-4 h-14">
          <a href="#portfolio" className="flex items-center gap-2 font-semibold tracking-tight text-lg">
            <span className="grid place-items-center h-7 w-7 rounded-[9px] bg-accent text-accent-foreground text-sm font-bold shadow-sm">K</span>
            Kredit
          </a>
          <span className="hidden md:inline text-xs text-muted-foreground">Credit risk platform</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span title={mode === "backend" ? "Reading from Supabase; writes go through the kredit-api function" : "No backend configured; data lives in this browser"} className={cn("hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1", mode === "backend" ? "bg-gain/15 text-gain" : "glass-pill text-muted-foreground")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "backend" ? "bg-gain" : "bg-muted-foreground")} />{mode === "backend" ? "Live database" : "Local demo"}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap"><Gauge className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />As of {d8(AS_OF)}</span>
            <button aria-label="Toggle theme" onClick={() => setDark(!dark)} className="h-9 w-9 grid place-items-center rounded-xl glass-pill">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className="lg:hidden glass rounded-2xl mt-2 flex gap-1 overflow-x-auto p-1">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={cn("px-3 h-8 inline-flex items-center gap-1.5 rounded-xl text-sm whitespace-nowrap", isActive(n.id) ? "glass-pill font-medium" : "text-muted-foreground")}>
              {n.label}{badge(n.id)}
            </a>
          ))}
        </nav>
      </header>
      <div className="flex px-3 md:px-4 gap-4">
        <aside className="hidden lg:block w-60 shrink-0 sticky top-[84px] self-start">
          <nav className="glass rounded-[24px] p-2.5 space-y-4">
            {NAV_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="micro px-3 pt-1 pb-1.5">{g.title}</div>
                <div className="space-y-0.5">
                  {g.items.map((n) => (
                    <a key={n.id} href={`#${n.id}`} aria-current={isActive(n.id) ? "page" : undefined} className={cn("flex items-center gap-2.5 px-3 h-9 rounded-xl text-sm transition-all", isActive(n.id) ? "glass-pill font-medium text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5")}>
                      <n.icon className={cn("h-4 w-4", isActive(n.id) && "text-accent")} />
                      <span>{n.label}</span>
                      {badge(n.id)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="glass rounded-[20px] mt-3 p-3.5 text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">How decisions are made.</span> Rules and the scorecard decide. People can review or override with a written reason. The AI assistant only drafts and explains.
          </div>
        </aside>
        <main className="flex-1 min-w-0 pb-10 pt-2 max-w-[1400px]">{page}</main>
      </div>
    </div>
  );
}
