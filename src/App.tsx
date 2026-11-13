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

const NAV = [
  { id: "portfolio", label: "Portfolio", icon: LayoutDashboard, mod: "10" },
  { id: "applications", label: "Applications", icon: FileText, mod: "1·3·7" },
  { id: "onboarding", label: "New application", icon: UserPlus, mod: "2" },
  { id: "review", label: "Review queue", icon: ClipboardCheck, mod: "7" },
  { id: "policy", label: "Credit policy", icon: BookOpen, mod: "4·5·6" },
  { id: "monitoring", label: "Monitoring", icon: Activity, mod: "8" },
  { id: "collections", label: "Collections & loss", icon: Wallet, mod: "9" },
  { id: "audit", label: "Audit log", icon: ScrollText, mod: "12" },
  { id: "data", label: "Data & model", icon: Database, mod: "1·5" },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const s = localStorage.getItem("kredit.theme");
      if (s) return s === "dark";
    } catch { /* ignore */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("kredit.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const route = useRoute();
  const { world } = useStore();
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

  return (
    <div className="min-h-screen">
      <div className="bg-primary text-primary-foreground text-[11px] text-center px-4 py-1.5">
        Demo · fictional US small-business lender · synthetic data only · no real customers or lending
      </div>
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/70 border-b">
        <div className="flex items-center gap-4 px-4 md:px-6 h-14">
          <a href="#/portfolio" className="font-semibold tracking-tight text-lg">Kredit™</a>
          <span className="hidden sm:inline text-xs text-muted-foreground">Credit risk platform</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground"><Gauge className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />As of {d8(AS_OF)}</span>
            <button aria-label="Toggle theme" onClick={() => setDark(!dark)} className="h-8 w-8 grid place-items-center rounded-xl hover:bg-muted">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className="lg:hidden flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={cn("px-3 h-8 inline-flex items-center rounded-xl text-sm whitespace-nowrap", section === n.id || (!section && n.id === "portfolio") ? "bg-card shadow-sm font-medium" : "text-muted-foreground")}>
              {n.label}{n.id === "review" && pending > 0 && <span className="ml-1.5 text-[10px] bg-warn/20 text-warn rounded-full px-1.5">{pending}</span>}
            </a>
          ))}
        </nav>
      </header>
      <div className="flex">
        <aside className="hidden lg:block w-60 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] p-3">
          <nav className="space-y-0.5">
            {NAV.map((n) => {
              const active = section === n.id || (!NAV.some((x) => x.id === section) && n.id === "portfolio");
              return (
                <a key={n.id} href={`#/${n.id}`} className={cn("flex items-center gap-2.5 px-3 h-9 rounded-xl text-sm transition-colors", active ? "bg-card shadow-sm font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}>
                  <n.icon className="h-4 w-4" />
                  <span className="flex-1">{n.label}</span>
                  {n.id === "review" && pending > 0 ? <span className="text-[10px] bg-warn/20 text-warn rounded-full px-1.5 font-semibold">{pending}</span> : <span className="text-[10px] text-muted-foreground/70">{n.mod}</span>}
                </a>
              );
            })}
          </nav>
          <div className="mt-6 mx-3 text-[11px] text-muted-foreground leading-relaxed">
            Rules and the scorecard make every decision. The AI assistant drafts and explains; it cannot approve or decline.
          </div>
        </aside>
        <main className="flex-1 min-w-0 px-4 md:px-6 py-6 max-w-[1400px]">{page}</main>
      </div>
    </div>
  );
}
