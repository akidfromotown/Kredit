// Horizontal score scale: decline / review / approve zones, band floors, and the applicant's position.
import type { Scorecard } from "../engine/policy";
import { scoreRange } from "../engine/policy";

export function ScoreGauge({ score, sc }: { score: number; sc: Scorecard }) {
  const [lo, hi] = scoreRange(sc);
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const zones = [
    { from: lo, to: sc.declineCutoff, cls: "bg-loss/25", label: "Decline" },
    { from: sc.declineCutoff, to: sc.approveCutoff, cls: "bg-warn/25", label: "Review" },
    { from: sc.approveCutoff, to: hi, cls: "bg-gain/25", label: "Approve" },
  ];
  const floors = (["A", "B", "C", "D"] as const).map((b) => ({ b, v: sc.bandFloors[b] })).filter((f) => f.v > lo && f.v < hi);
  return (
    <div className="pt-7 pb-6" role="img" aria-label={`Score ${score} on a scale from ${lo} to ${hi}. Decline below ${sc.declineCutoff}, approve from ${sc.approveCutoff}.`}>
      <div className="relative h-3 rounded-full overflow-hidden flex">
        {zones.map((z) => (
          <div key={z.label} className={z.cls} style={{ width: `${((z.to - z.from) / (hi - lo)) * 100}%` }} />
        ))}
      </div>
      <div className="relative">
        {/* zone labels */}
        {zones.map((z) => (
          <span key={z.label} className="absolute top-1.5 -translate-x-1/2 text-[10px] text-muted-foreground" style={{ left: `calc((${pos(z.from)} + ${pos(z.to)}) / 2)` }}>{z.label}</span>
        ))}
        {/* band floors */}
        {floors.map((f) => (
          <span key={f.b} className="absolute -top-[18px] -translate-x-1/2 text-[9px] font-semibold text-muted-foreground" style={{ left: pos(f.v) }}>
            <span className="block h-2 w-px bg-muted-foreground/40 mx-auto mb-0.5" />
          </span>
        ))}
        {/* marker */}
        <div className="absolute -top-[30px] -translate-x-1/2 flex flex-col items-center" style={{ left: pos(score) }}>
          <span className="glass-pill rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">{score}</span>
          <span className="h-4 w-0.5 bg-foreground rounded-full" />
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-6 tabular-nums">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}
