// Lightweight UI primitives styled with the Kredit design tokens (glass cards, sentence case, neutral palette).
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Info } from "lucide-react";
import { GLOSSARY, type Term } from "./glossary";

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
  return <div className={cn("glass rounded-2xl", className)}>{children}</div>;
}

/** Small info button that explains a term in plain language (hover, focus or tap). */
export function InfoTip({ term, text, align = "center" }: { term?: Term; text?: string; align?: "center" | "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const body = text ?? (term ? GLOSSARY[term] : "");
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="What does this mean?"
        aria-describedby={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 text-muted-foreground/70 hover:text-accent transition-colors"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "glass glass-strong absolute z-50 top-6 w-64 rounded-2xl p-3 text-xs font-normal normal-case tracking-normal leading-relaxed text-foreground",
            align === "center" && "left-1/2 -translate-x-1/2",
            align === "left" && "left-0",
            align === "right" && "right-0",
          )}
        >
          {body}
        </span>
      )}
    </span>
  );
}

/** Tiny trend line for stat cards. */
export function Sparkline({ values, tone = "accent" }: { values: number[]; tone?: "accent" | "gain" | "loss" | "warn" }) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 2) return null;
  const w = 160, h = 30;
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = hi - lo || 1;
  const pts = vs.map((v, i) => [(i / (vs.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 6)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = `hsl(var(--${tone}))`;
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible block" aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ex} cy={ey} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function CardHead({ title, right, term }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; term?: Term }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-medium tracking-tight flex items-center">{title}{term && <InfoTip term={term} align="left" />}</h3>
        {/* card subtitles intentionally not rendered: cards carry short titles only */}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, tone, term, spark, sparkTone, delta }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "gain" | "loss" | "warn"; term?: Term;
  spark?: number[]; sparkTone?: "accent" | "gain" | "loss" | "warn";
  /** Change vs. the previous period; `good` colours it. */
  delta?: { text: string; good: boolean | null };
}) {
  return (
    <Card className="p-4 flex flex-col">
      <div className="micro flex items-center">{label}{term && <InfoTip term={term} align="left" />}</div>
      <div className={cn("num text-[30px] leading-none mt-3", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{value}</div>
      {spark && <div className="mt-2.5 -mx-0.5"><Sparkline values={spark} tone={sparkTone} /></div>}
      {delta && (
        <div className={cn("text-[11px] font-semibold mt-2", delta.good === true && "text-gain", delta.good === false && "text-loss", delta.good === null && "text-muted-foreground")}>{delta.text}</div>
      )}
    </Card>
  );
}

const TONES = {
  neutral: "bg-foreground/[0.06] text-muted-foreground",
  gain: "bg-gain/10 text-gain",
  loss: "bg-loss/10 text-loss",
  warn: "bg-warn/10 text-warn",
  solid: "bg-primary text-primary-foreground",
  outline: "border border-[hsl(var(--glass-line))] text-muted-foreground",
};
export type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function statusTone(s: string): Tone {
  if (["APPROVE", "APPROVED", "pass", "current"].includes(s)) return "gain";
  if (["DECLINE", "DECLINED", "fail", "high", "concern"].includes(s)) return "loss";
  if (["REVIEW", "PENDING_REVIEW", "refer", "medium", "watch"].includes(s)) return "warn";
  return "neutral";
}

export function StatusPill({ s }: { s: string }) {
  const label = s === "PENDING_REVIEW" ? "Pending review" : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
  const t = statusTone(s);
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap">
      <span className={cn("h-1.5 w-1.5 rounded-full", t === "gain" && "bg-gain", t === "loss" && "bg-loss", t === "warn" && "bg-warn", t === "neutral" && "bg-muted-foreground")} />
      {label}
    </span>
  );
}

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "outline" && "glass-pill hover:brightness-105",
        variant === "ghost" && "hover:bg-muted",
        variant === "danger" && "bg-loss text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="glass flex gap-1 overflow-x-auto rounded-2xl p-1 w-fit max-w-full">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cn("px-3 h-8 rounded-xl text-sm whitespace-nowrap transition-all", value === t.id ? "glass-pill font-medium" : "text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function PageHeader({ title, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-light tracking-tight">{title}</h1>
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
  grid: "hsl(var(--glass-line))",
  axis: "hsl(var(--muted-foreground))",
};

export const tooltipStyle = {
  contentStyle: { background: "hsl(var(--glass-fill-strong))", backdropFilter: "blur(20px) saturate(180%)", border: "1px solid hsl(var(--glass-edge))", borderRadius: 14, fontSize: 12, color: "hsl(var(--foreground))", boxShadow: "0 10px 30px -8px hsl(var(--glass-shadow))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};
