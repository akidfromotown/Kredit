// Module 2: mocked KYC / KYB checks. No real vendors are called; results are seeded per applicant.
import type { KycCheck, KycStatus } from "./types";
import { Rng } from "./rng";

export type KycScenario = "auto" | "clean" | "refer" | "fail";

interface CheckDef {
  id: string;
  group: "KYB" | "KYC";
  name: string;
  provider: string;
  pRefer: number;
  pFail: number;
  pass: string;
  refer: string;
  fail: string;
}

const CHECKS: CheckDef[] = [
  { id: "tin", group: "KYB", name: "EIN / TIN match", provider: "Mock IRS TIN service", pRefer: 0.004, pFail: 0.004,
    pass: "Legal name and EIN match IRS records.", refer: "Partial name match on EIN; DBA may differ from legal name.", fail: "EIN does not match legal business name." },
  { id: "sos", group: "KYB", name: "Secretary of State standing", provider: "Mock SoS registry", pRefer: 0.008, pFail: 0.004,
    pass: "Entity active and in good standing.", refer: "Annual report overdue; entity still active.", fail: "Entity status is dissolved / revoked." },
  { id: "addr", group: "KYB", name: "Business address verification", provider: "Mock address graph", pRefer: 0.012, pFail: 0,
    pass: "Commercial address verified.", refer: "Address resolves to a residential or virtual office.", fail: "" },
  { id: "idv", group: "KYC", name: "Owner identity (SSN / DOB)", provider: "Mock identity bureau", pRefer: 0.006, pFail: 0.003,
    pass: "SSN, name and date of birth match.", refer: "Date of birth mismatch on one source.", fail: "SSN belongs to a different individual." },
  { id: "ofac", group: "KYC", name: "OFAC / sanctions screen", provider: "Mock sanctions list", pRefer: 0.004, pFail: 0.001,
    pass: "No match on SDN or consolidated lists.", refer: "Potential name match; needs analyst disposition.", fail: "Confirmed sanctions list match." },
  { id: "pep", group: "KYC", name: "PEP & adverse media", provider: "Mock media screen", pRefer: 0.006, pFail: 0,
    pass: "No PEP status or material adverse media.", refer: "Adverse media hit (civil litigation) needs review.", fail: "" },
  { id: "doc", group: "KYC", name: "ID document & liveness", provider: "Mock doc verification", pRefer: 0.005, pFail: 0.002,
    pass: "Driver license authentic; selfie liveness matched.", refer: "Image quality too low; resubmission requested.", fail: "Document shows signs of tampering." },
];

export function runKycChecks(seed: string, scenario: KycScenario = "auto"): KycCheck[] {
  const rng = new Rng(seed + ":kyc");
  const forced = scenario === "refer" ? "ofac" : scenario === "fail" ? "tin" : null;
  return CHECKS.map((c) => {
    let status: KycStatus = "pass";
    if (scenario === "auto") {
      const r = rng.next();
      if (r < c.pFail) status = "fail";
      else if (r < c.pFail + c.pRefer) status = "refer";
    } else if (forced === c.id) {
      status = scenario === "refer" ? "refer" : "fail";
    }
    return { id: c.id, group: c.group, name: c.name, provider: c.provider, status, detail: c[status] };
  });
}

export function kycOutcome(checks: KycCheck[]): KycStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "refer")) return "refer";
  return "pass";
}
