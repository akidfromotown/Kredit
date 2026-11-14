import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { appendAudit, verifyChain, type AuditEntry } from "./audit";
import { draftCreditMemo, explainDecline, screenDocuments } from "./assistant";
import { buildBusiness, generatePortfolio } from "./data";
import { decide, finalStatus } from "./decision";
import { DEFAULT_POLICY, clonePolicy } from "./policy";
import { amortPayment } from "./loanSim";

const biz = generatePortfolio();
const decisions = biz.map((b) => decide(b, DEFAULT_POLICY, b.application.appliedOn + "T10:00:00Z"));

describe("synthetic data", () => {
  it("generates 500 businesses with 12 pre-application months, deterministically", () => {
    expect(biz).toHaveLength(500);
    expect(biz.every((b) => b.months.filter((m) => m.phase === "pre").length === 12)).toBe(true);
    const again = generatePortfolio();
    expect(again.map((b) => b.months[3].revenue)).toEqual(biz.map((b) => b.months[3].revenue));
  });
});

describe("decisions", () => {
  it("every decline states at least one specific reason", () => {
    const declines = decisions.filter((d) => d.engineOutcome === "DECLINE");
    expect(declines.length).toBeGreaterThan(50);
    for (const d of declines) {
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.reasons.every((r) => r.code && r.text.length > 20)).toBe(true);
    }
  });

  it("score-based declines list the adverse factors, not just the cutoff", () => {
    const d = decisions.find((x) => x.reasons[0]?.code === "SC-CUTOFF")!;
    expect(d.reasons.filter((r) => r.stage === "score").length).toBeGreaterThan(1);
  });

  it("stores inputs, rule version, score and reasons on every decision", () => {
    for (const d of decisions) {
      expect(d.policyVersion).toBe(DEFAULT_POLICY.version);
      expect(d.inputs.attributes.avgMonthlyRevenue).toBeGreaterThan(0);
      expect(d.inputs.application.id).toBeTruthy();
      expect(typeof d.score).toBe("number");
      expect(d.knockouts.length).toBe(DEFAULT_POLICY.rules.filter((r) => r.enabled).length);
    }
  });

  it("a knockout hit always declines with that rule's code", () => {
    for (const d of decisions.filter((x) => x.kycOutcome !== "fail" && x.knockouts.some((k) => k.hit))) {
      expect(d.engineOutcome).toBe("DECLINE");
      for (const k of d.knockouts.filter((x) => x.hit)) expect(d.reasons.map((r) => r.code)).toContain(k.ruleId);
    }
  });

  it("offers never exceed the affordability cap or the request", () => {
    for (const d of decisions.filter((x) => x.offer && x.offer.amount > 0)) {
      const o = d.offer!;
      expect(o.amount).toBeLessThanOrEqual(d.inputs.application.requestedAmount);
      expect(amortPayment(o.amount, o.aprPct, o.termMonths)).toBeLessThanOrEqual(o.maxAffordablePayment + 1);
    }
  });

  it("disabling a knockout rule changes outcomes only under the new version", () => {
    const p = clonePolicy(DEFAULT_POLICY);
    p.version = "POL-1.1";
    p.rules.find((r) => r.id === "KO-TIB")!.enabled = false;
    const b = biz.find((x, i) => decisions[i].reasons.some((r) => r.code === "KO-TIB") && decisions[i].reasons.length === 1)!;
    const d2 = decide(b, p, "2026-11-01T00:00:00Z");
    expect(d2.policyVersion).toBe("POL-1.1");
    expect(d2.reasons.map((r) => r.code)).not.toContain("KO-TIB");
  });

  it("onboarding a failed-KYB applicant declines with the verification reason", () => {
    const b = buildBusiness({
      id: "BIZ-TEST1", name: "Test Co", industry: "Restaurant", state: "CA", entityType: "LLC", monthsInBusiness: 60, ownerName: "A B",
      ownerCreditScore: 760, requestedAmount: 50000, requestedTermMonths: 12, purpose: "x", statedAnnualRevenue: 900000,
      appliedOn: "2026-11-02", bankProfile: "strong", kycScenario: "fail",
    });
    const d = decide(b, DEFAULT_POLICY, "2026-11-02T10:00:00Z");
    expect(d.engineOutcome).toBe("DECLINE");
    expect(d.reasons[0].code).toBe("KYC-TIN");
  });
});

describe("AI assistant guardrails", () => {
  it("returns text only and never an outcome", () => {
    const i = decisions.findIndex((d) => finalStatus(d) === "DECLINED");
    for (const out of [screenDocuments(biz[i], decisions[i]), draftCreditMemo(biz[i], decisions[i]), explainDecline(biz[i], decisions[i])]) {
      expect(Object.keys(out).sort()).toEqual(["body", "disclaimer", "grounding", "task", "title"]);
    }
  });

  it("decline explanations only restate stored reason codes", () => {
    const i = decisions.findIndex((d) => d.reasons.some((r) => r.code === "KO-NSF"));
    expect(explainDecline(biz[i], decisions[i]).body).toMatch(/returned or overdrawn/);
  });

  it("the decision engine does not import the assistant", () => {
    const src = readFileSync(new URL("./decision.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "\.\/assistant"/);
  });
});

describe("audit log", () => {
  it("detects tampering with any entry", () => {
    const log: AuditEntry[] = [];
    for (let i = 0; i < 5; i++) appendAudit(log, { at: `2026-01-0${i + 1}`, actor: "t", actorType: "system", type: "DECISION", ref: `D${i}`, summary: "s", payload: { i } });
    expect(verifyChain(log).ok).toBe(true);
    (log[2].payload as { i: number }).i = 99;
    expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 3 });
  });
});

describe("financial crime", () => {
  it("raises deterministic screening and monitoring alerts", async () => {
    const { buildAlerts } = await import("./fincrime");
    const a = buildAlerts(biz);
    expect(a.length).toBeGreaterThan(20);
    expect(a.some((x) => x.source === "monitoring")).toBe(true);
    expect(buildAlerts(biz).map((x) => x.id)).toEqual(a.map((x) => x.id));
  });

  it("requires a note, and closed alerts cannot be acted on again", async () => {
    const { buildAlerts, alertStatuses } = await import("./fincrime");
    const { validateDisposition, fincrimeAudit } = await import("./world");
    const alert = buildAlerts(biz)[0];
    expect(() => validateDisposition(alert, "open", { action: "clear", note: "short" }, "t", "2026-11-01T00:00:00Z")).toThrow(/note/);
    const d = validateDisposition(alert, "open", { action: "clear", note: "Different person, date of birth does not match." }, "t", "2026-11-01T00:00:00Z");
    const log: AuditEntry[] = [];
    appendAudit(log, fincrimeAudit(d, alert));
    const st = alertStatuses(log).get(alert.id)!;
    expect(st.status).toBe("cleared");
    expect(() => validateDisposition(alert, st.status, { action: "refer", note: "Changing my mind after closing." }, "t", "2026-11-02T00:00:00Z")).toThrow(/closed/);
  });
});
