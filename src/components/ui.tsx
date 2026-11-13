// Lightweight UI primitives styled with the Steady design tokens (glass cards, sentence case, neutral palette).
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

export const usd = (v: number, compact = false) =>
  compact && Math.abs(v) >= 10000
    ? `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`
    : `$${Math.round(v).toLocaleString("en-US")}`;
export const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;
export const num = (v: number) => Math.round(v).toLocaleString("en-US");
export const dt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const d8 = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass-card rounded-3xl", className)}>{children}</div>;
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="micro">{label}</div>
      <div className={cn("text-[21px] font-bold tracking-tight mt-1 tabular-nums", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

const TONES = {
  neutral: "bg-secondary text-secondary-foreground",
  gain: "bg-gain/15 text-gain",
  loss: "bg-loss/15 text-loss",
  warn: "bg-warn/15 text-warn",
  solid: "bg-primary text-primary-foreground",
  outline: "border text-muted-foreground",
};
export type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function statusTone(s: string): Tone {
  if (["APPROVE", "APPROVED", "pass", "current"].includes(s)) return "gain";
  if (["DECLINE", "DECLINED", "fail", "high", "concern"].includes(s)) return "loss";
  if (["REVIEW", "PENDING_REVIEW", "refer", "medium", "watch"].includes(s)) return "warn";
  return "neutral";
}

export function StatusPill({ s }: { s: string }) {
  const label = s === "PENDING_REVIEW" ? "Pending review" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
  return <Pill tone={statusTone(s)}>{label}</Pill>;
}

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "outline" && "border bg-card hover:bg-muted",
        variant === "ghost" && "hover:bg-muted",
        variant === "danger" && "bg-loss text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1 w-fit max-w-full">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cn("px-3 h-8 rounded-xl text-sm whitespace-nowrap transition-colors", value === t.id ? "bg-card shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Renders the assistant's markdown-light text (## headings, - bullets, [severity] tags). */
export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("## ")) return <div key={i} className="font-semibold pt-2">{line.slice(3)}</div>;
        if (line.startsWith("- ")) {
          const m = line.slice(2).match(/^\[(concern|watch|info)\] (.*)$/);
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground">•</span>
              <span>{m ? <><Pill tone={statusTone(m[1])} className="mr-1.5">{m[1]}</Pill>{m[2]}</> : line.slice(2)}</span>
            </div>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const chartColors = {
  c1: "hsl(var(--chart-1))",
  c2: "hsl(var(--chart-2))",
  c3: "hsl(var(--chart-3))",
  c4: "hsl(var(--chart-4))",
  c5: "hsl(var(--chart-5))",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
};

export const tooltipStyle = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};
