// Module 2: onboarding with mocked KYC / KYB and a mocked bank connection, then a live decision.
import { useEffect, useState } from "react";
import { Check, Landmark, Loader2 } from "lucide-react";
import { useStore } from "../store";
import { INDUSTRIES, type NewBusinessInput } from "../engine/data";
import { finalStatus, type Decision } from "../engine/decision";
import { runKycChecks, type KycScenario } from "../engine/kyc";
import { Button, Card, CardHead, Field, PageHeader, Pill, StatusPill, usd } from "../components/ui";
import { go } from "../router";

const STATES = ["CA", "TX", "FL", "NY", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "VA", "WA", "AZ", "MA", "CO"];

export default function OnboardingPage() {
  const { onboard, world, policy } = useStore();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: "Bright Harbor Coffee Roasters LLC", industry: "Restaurant", state: "OR", entityType: "LLC" as NewBusinessInput["entityType"],
    monthsInBusiness: 46, statedAnnualRevenue: 780000, ownerName: "Alex Rivera", ownerCreditScore: 712,
    requestedAmount: 75000, requestedTermMonths: 18, purpose: "Equipment purchase",
    bankProfile: "average" as NewBusinessInput["bankProfile"], kycScenario: "clean" as KycScenario,
  });
  const [checking, setChecking] = useState(0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const preview = runKycChecks("preview", f.kycScenario);

  useEffect(() => {
    if (step !== 2) return;
    setChecking(0);
    const t = setInterval(() => setChecking((c) => c + 1), 280);
    return () => clearInterval(t);
  }, [step]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      setDecision(await onboard({ ...f }));
      setStep(3);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = ["Business (KYB)", "Owner (KYC)", "Verify & connect bank", "Decision"];

  return (
    <div className="max-w-4xl">
      <PageHeader title="New application" sub={`Walk a fictional applicant through onboarding. Verification and the bank connection are mocked; the decision runs live under ${policy.version}.`} />
      <div className="flex flex-wrap gap-2 mb-4">
        {steps.map((s, i) => <Pill key={s} tone={i === step ? "solid" : i < step ? "gain" : "outline"}>{i + 1}. {s}</Pill>)}
      </div>

      {step === 0 && (
        <Card>
          <CardHead title="Business details" sub="Used for KYB checks and application data" />
          <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
            <Field label="Legal business name"><input className="inp w-full" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Industry">
              <select className="inp w-full" value={f.industry} onChange={(e) => set("industry", e.target.value)}>{INDUSTRIES.map((i) => <option key={i.name}>{i.name}</option>)}</select>
            </Field>
            <Field label="State"><select className="inp w-full" value={f.state} onChange={(e) => set("state", e.target.value)}>{[...STATES, "OR"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Entity type">
              <select className="inp w-full" value={f.entityType} onChange={(e) => set("entityType", e.target.value as NewBusinessInput["entityType"])}>{["LLC", "S-Corp", "C-Corp", "Sole proprietor", "Partnership"].map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Months in business"><input type="number" className="inp w-full" value={f.monthsInBusiness} onChange={(e) => set("monthsInBusiness", Number(e.target.value))} /></Field>
            <Field label="Stated annual revenue"><input type="number" className="inp w-full" value={f.statedAnnualRevenue} onChange={(e) => set("statedAnnualRevenue", Number(e.target.value))} /></Field>
            <Field label="Requested amount"><input type="number" className="inp w-full" value={f.requestedAmount} step={5000} onChange={(e) => set("requestedAmount", Number(e.target.value))} /></Field>
            <Field label="Term">
              <select className="inp w-full" value={f.requestedTermMonths} onChange={(e) => set("requestedTermMonths", Number(e.target.value))}>{policy.pricing.terms.map((t) => <option key={t} value={t}>{t} months</option>)}</select>
            </Field>
            <Field label="Purpose"><input className="inp w-full" value={f.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>
          </div>
          <div className="px-5 pb-5"><Button onClick={() => setStep(1)} disabled={!f.name.trim() || f.requestedAmount <= 0}>Continue</Button></div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHead title="Principal owner" sub="Used for KYC checks and the mock bureau pull" />
          <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
            <Field label="Owner name"><input className="inp w-full" value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
            <Field label="Owner credit score (mock bureau)"><input type="number" className="inp w-full" value={f.ownerCreditScore} min={300} max={850} onChange={(e) => set("ownerCreditScore", Number(e.target.value))} /></Field>
            <Field label="Demo control: verification outcome" hint="Pick how the mocked KYC/KYB vendors respond">
              <select className="inp w-full" value={f.kycScenario} onChange={(e) => set("kycScenario", e.target.value as KycScenario)}>
                <option value="clean">All checks pass</option>
                <option value="refer">Sanctions potential match (refer)</option>
                <option value="fail">EIN mismatch (fail)</option>
              </select>
            </Field>
            <Field label="Demo control: bank data the connection returns" hint="Drives the synthetic 12-month transaction history">
              <select className="inp w-full" value={f.bankProfile} onChange={(e) => set("bankProfile", e.target.value as NewBusinessInput["bankProfile"])}>
                <option value="strong">Strong cash flow</option>
                <option value="average">Average</option>
                <option value="weak">Weak / stressed</option>
              </select>
            </Field>
          </div>
          <div className="px-5 pb-5 flex gap-2"><Button variant="outline" onClick={() => setStep(0)}>Back</Button><Button onClick={() => setStep(2)} disabled={!f.ownerName.trim()}>Run verification</Button></div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHead title="Verification and bank connection" sub="Mocked vendor calls" />
          <div className="px-5 pb-5 space-y-2.5">
            {[...preview.map((c) => ({ name: `${c.group} · ${c.name}`, status: c.status, detail: c.detail })), { name: "Bank connection · 12 months of statements", status: "pass" as const, detail: "Mock aggregator returned 12 statement months." }].map((c, i) => (
              <div key={c.name} className="flex items-center gap-3 text-sm">
                {checking > i ? (c.status === "pass" ? <Check className="h-4 w-4 text-gain" /> : <StatusPill s={c.status} />) : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <span className="font-medium">{c.name}</span>
                {checking > i && <span className="text-muted-foreground text-xs">{c.detail}</span>}
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={submit} disabled={checking <= preview.length || busy}><Landmark className="h-4 w-4" />{busy ? "Deciding…" : "Submit for decision"}</Button>
          </div>
          {err && <p className="px-5 pb-5 -mt-2 text-sm text-loss">{err}</p>}
        </Card>
      )}

      {step === 3 && decision && (
        <Card>
          <CardHead title="Decision" sub={`${decision.id} · ${decision.policyVersion} · logged to the audit trail`} right={<StatusPill s={finalStatus(decision)} />} />
          <div className="px-5 pb-5 space-y-3">
            <div className="text-sm">Score <b>{decision.score}</b> · band <b>{decision.band}</b>{decision.offer?.amount ? <> · offer <b>{usd(decision.offer.amount)}</b> at {decision.offer.aprPct}% for {decision.offer.termMonths} months</> : null}</div>
            <ul className="space-y-1.5">{decision.reasons.map((r, i) => <li key={i} className="text-sm flex gap-2"><Pill tone="outline" className="font-mono shrink-0">{r.code}</Pill>{r.text}</li>)}</ul>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => go(`applications/${decision.businessId}`)}>Open application</Button>
              <Button variant="outline" onClick={() => { setStep(0); setDecision(null); }}>Start another</Button>
            </div>
            <p className="text-xs text-muted-foreground">{world.businesses.filter((b) => b.source === "onboarded").length} onboarded applicant(s) in this browser.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
