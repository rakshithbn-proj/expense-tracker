import { describe, expect, it } from "vitest";
import { verifySender } from "@/server/ingestion/email/authentication";

// Shapes copied from the real samples (identifying parts shortened).
const HDFC_REAL =
  'mx.google.com; dkim=pass header.i=@hdfcbank.bank.in header.s=acls01 header.b="DJxK6D/S"; dkim=pass header.i=@aclmobile.net header.s=x header.b=euOGOpuq; spf=pass (google.com: domain of a.1@comm.hdfcbank.bank.in designates 1.2.3.4 as permitted sender) smtp.mailfrom=a.1@comm.hdfcbank.bank.in; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=hdfcbank.bank.in';
const ICICI_REAL =
  'mx.google.com; dkim=pass header.i=@icici.bank.in header.s=icici header.b="Zg/tiMj6"; spf=pass (google.com: domain of credit_cards@icici.bank.in designates 103.169.235.13 as permitted sender) smtp.mailfrom=credit_cards@icici.bank.in; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=icici.bank.in';
const FORWARDED =
  "mx.google.com; arc=pass (i=1 spf=pass spfdomain=comm.hdfcbank.bank.in dkim=pass dkdomain=hdfcbank.bank.in dmarc=pass fromdomain=hdfcbank.bank.in); spf=pass (google.com: domain of you+caf_=other@gmail.com designates 209.85.220.41 as permitted sender) smtp.mailfrom=you+caf_=other@gmail.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=hdfcbank.bank.in";

describe("verifySender", () => {
  it("accepts real bank alerts signed by the bank's own domain", () => {
    expect(verifySender("alerts@hdfcbank.bank.in", [HDFC_REAL])).toEqual({ verified: true, detail: "DKIM pass for hdfcbank.bank.in" });
    expect(verifySender("credit_cards@icici.bank.in", [ICICI_REAL]).verified).toBe(true);
  });

  it("accepts an auto-forwarded alert through Gmail's ARC result", () => {
    expect(verifySender("alerts@hdfcbank.bank.in", [FORWARDED])).toEqual({ verified: true, detail: "ARC pass, original DKIM for hdfcbank.bank.in" });
  });

  it("rejects a forged From address signed by someone else's domain", () => {
    const spoof = "mx.google.com; dkim=pass header.i=@attacker.example header.s=s; spf=pass smtp.mailfrom=attacker.example; dmarc=fail (p=REJECT) header.from=hdfcbank.bank.in";
    expect(verifySender("alerts@hdfcbank.bank.in", [spoof]).verified).toBe(false);
  });

  it("rejects failed or missing signatures", () => {
    expect(verifySender("alerts@hdfcbank.bank.in", ["mx.google.com; dkim=fail header.i=@hdfcbank.bank.in; dmarc=fail"]).verified).toBe(false);
    expect(verifySender("alerts@hdfcbank.bank.in", []).verified).toBe(false);
    expect(verifySender("alerts@hdfcbank.bank.in", ["other.example; dkim=pass header.i=@hdfcbank.bank.in"]).verified).toBe(false);
  });

  it("only trusts Gmail's topmost result, not a planted 'pass' further down", () => {
    const gmailSaysFail = "mx.google.com; dkim=none; spf=softfail; dmarc=fail header.from=hdfcbank.bank.in";
    const planted = "mx.google.com; dkim=pass header.i=@hdfcbank.bank.in";
    expect(verifySender("alerts@hdfcbank.bank.in", [gmailSaysFail, planted]).verified).toBe(false);
  });

  it("doesn't accept a look-alike domain", () => {
    const lookalike = "mx.google.com; dkim=pass header.i=@evilhdfcbank.bank.in";
    expect(verifySender("alerts@hdfcbank.bank.in", [lookalike]).verified).toBe(false);
    const sub = "mx.google.com; dkim=pass header.i=@mail.hdfcbank.bank.in";
    expect(verifySender("alerts@hdfcbank.bank.in", [sub]).verified).toBe(true);
  });
});
