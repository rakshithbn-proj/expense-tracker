# Capture Feasibility Report

Status: **Milestone 0 draft, 2026-10-22.** Based on documentation research only. Nothing in this
report has been tested on the user's iPhone, Gmail account or statements yet. Each claim is
labelled **Documented** (official source), **Reported** (community or third-party source) or **Untested**.

## 1. Summary

1. **iOS cannot read PhonePe or Google Pay notifications.** iOS 26 has no "notification
   received" automation trigger, and no supported API lets a Shortcut read another app's
   notification text. *(Documented: Apple's Shortcuts trigger list. Reported: iOS 26 added
   new actions, not new triggers.)* Zero-touch capture **from the UPI apps themselves** is not
   possible on iOS. We will not simulate it.
2. **Every UPI payment moves money from an account that a bank alerts on.** The source is a bank
   account, a RuPay credit card on UPI, or a UPI credit line. So the capture point for UPI should
   be the **bank's alert**, not the UPI app. That alert can arrive by email (Gmail API, automatic,
   server-side) or by SMS (iOS Message automation, automatic on the phone). The bank alert usually
   gives the amount, the account, the UPI reference (RRN) and often the payee VPA or name. It
   usually does **not** say which UPI app was used.
3. **Gmail is the strongest automatic source.** It runs on the server, needs no phone
   interaction, and supports catch-up after downtime. Coverage depends on which alerts each bank
   actually emails. This is unknown until we look at the user's mailbox (test G1).
4. **The iOS Message automation (bank SMS) is a second automatic source.** It can trigger on SMS
   containing a phrase and pass the message text to the Shortcut. *(Documented: Message trigger
   with "Sender" and "Message Contains". Reported: message text available as Shortcut Input and
   "Run Immediately" possible.)* The user says bank SMS are unreliable, so this is a supplement.
   It must be measured, not assumed.
5. **UPI app receipts can be shared to a Shortcut by the user.** This is user-triggered, not
   automatic. The Shortcut runs on-device OCR ("Extract Text from Image") and posts the text.
   Whether PhonePe or GPay expose text or only an image to the share sheet is **Untested** (test I4).
6. **Statement CSV reconciliation is the safety net.** It catches everything that posts to an
   account, but only when the user imports a statement. These transactions never count toward
   automatic coverage.

**Expected outcome:** Reaching 99% automatic coverage depends on every bank and card emailing
(or SMSing) every debit. For UPI on SBI and ICICI in particular, that is not established.
**No coverage estimate can be made until tests G1 and S1–S3 produce evidence.**

## 2. Capability matrix (initial registry contents)

| Source | Mechanism | Mode | Merchant/amount | Reference | Tested | Initial status |
|---|---|---|---|---|---|---|
| Gmail: HDFC bank alerts | Gmail API history polling | Automatic | Amount yes; payee often a VPA/name | Usually UPI RRN | No | Not configured |
| Gmail: SBI bank alerts | Gmail API | Automatic | Unknown | Unknown | No | Not configured (coverage of UPI debits unknown) |
| Gmail: ICICI bank alerts | Gmail API | Automatic | Unknown | Unknown | No | Not configured |
| Gmail: HDFC / ICICI / HSBC / AMEX / RBL card alerts | Gmail API | Automatic | Amount + merchant usually | Sometimes | No | Not configured |
| iPhone: bank SMS | Shortcuts Message automation → HTTPS POST | Automatic (on-device) | From SMS text | Often RRN | No | Available for testing |
| iPhone: UPI app receipt | Share Sheet → OCR → POST | **User-triggered** | From receipt | UPI txn ID if visible | No | Available for testing |
| iPhone: manual entry | Shortcut asks amount/merchant | **Manual** | User-entered | None | No | Available for testing |
| iPhone: PhonePe/GPay notifications | — | — | — | — | — | **Unsupported by the current platform** |
| iPhone: Wallet "transaction" trigger | Shortcuts Wallet trigger | Automatic | Yes | — | No | Unsupported in practice: only Apple Pay cards, and Indian-issued cards aren't supported in Apple Pay (verify) |
| Bank CSV statements (SBI/ICICI/HDFC) | Upload + parser | Manual import | Description | Sometimes | No | Not configured |
| Card CSV statements (5 issuers) | Upload + parser | Manual import | Description | Rarely | No | Not configured. Some issuers only provide PDF statements (verify) |
| PhonePe / Google Pay / bank APIs | — | — | — | — | — | Not available: no public personal-use APIs exist. Account Aggregator access needs an RBI-regulated FIU licence and isn't eligible for a personal app |

## 3. Capabilities that must not be confused

| Capability | Possible on iOS 26 via supported means? |
|---|---|
| Detect that PhonePe/GPay was opened or closed | Yes (App trigger). Gives no transaction data |
| Receive a notification from PhonePe/GPay | Yes, the user sees it. Shortcuts cannot observe it |
| Read the content of another app's notification | **No** |
| Extract structured payment details from a UPI app | Only from content the user shares (user-triggered) |
| Read incoming SMS text | Yes, via Message automation for SMS that match a filter (Untested on this device) |
| Send data to a remote backend without a tap | Yes, from an automation set to "Run Immediately" (Untested) |

## 4. Gmail API

- Scope: `https://www.googleapis.com/auth/gmail.readonly`. This is a **restricted** scope.
- Verification: Google exempts **personal-use apps (fewer than 100 users)**. The user clicks
  through the "unverified app" warning. *(Documented: Google Cloud "When is verification not needed".)*
- **Critical pitfall:** in **Testing** publishing status, refresh tokens expire after **7 days**,
  so ingestion would silently stop every week. The OAuth consent screen must be set to
  **In production** (unverified, personal use). The app must also detect `invalid_grant` and
  raise a source-authorization notification.
- Latency: polling `users.history.list` every 60 seconds is cheap and meets the 5-minute target
  without Pub/Sub. Pub/Sub push is optional and deferred (ADR-0004).
- Sheets: `spreadsheets` scope is *sensitive* (not restricted). It's covered by the same
  personal-use exemption. We could use `drive.file` instead if the app creates the sheet itself (decided in M7).

## 5. Tests that must be run on the actual iPhone

| ID | Test | What to record |
|---|---|---|
| I1 | Settings → General → About | Exact iOS version and iPhone model |
| I2 | Shortcuts → Automation → New → Message → "Message Contains: debited" → Run Immediately → action *Show Notification* with *Shortcut Input* | Does it fire without a tap? Is the full SMS text shown? |
| I3 | Repeat I2 for each bank's SMS sender over 7 days | Fraction of payments that produced an SMS |
| I4 | PhonePe and GPay: open a past payment → Share | Does Shortcuts appear in the share sheet? Is the shared item an image, text or link? |
| I5 | Shortcuts → New Automation list | Confirm there is no "Notification" trigger and whether a "Wallet"/"Transaction" trigger exists |

No Shortcut built for the user will ask for a UPI PIN, password, CVV or OTP.

## 6. Evidence needed from Gmail and statements

| ID | Task |
|---|---|
| G1 | For each bank and card: search Gmail for the last 60 days of alerts (for example `from:alerts@hdfcbank.net`). Record the sender address and which transaction types get an email (UPI debit, card swipe, online card, NEFT/IMPS, ATM, refund, bill payment) |
| G2 | Provide 2–3 **redacted** sample emails per type (mask account digits and names; keep layout, amounts and wording). These become parser fixtures |
| S1 | For each account: can you download CSV/XLS statements, or only PDF? |
| S2 | One redacted statement per institution for the parser fixtures |
| S3 | Over one month, count UPI payments in the statement versus alert emails received. This is our first real coverage estimate |

## 6a. Evidence received (2026-10-22)

Real alert emails supplied by the user (kept locally; redacted copies are test fixtures):

| Institution | Alert seen | Sender | Notes |
|---|---|---|---|
| HDFC credit card | Card purchase | `alerts@hdfcbank.bank.in` | Amount, card, merchant, date and time |
| HDFC RuPay credit card | **UPI payment** | `alerts@hdfcbank.bank.in` | UPI payments from this card are emailed, with the UPI reference and payee UPI ID |
| HSBC credit card | Card purchase | `hsbc@hsbc.bank.in` | Date only, no time |
| ICICI credit card | Card purchase | `credit_cards@icici.bank.in` | Amount, card, merchant, date and time |
| RBL credit card | Card purchase | `RBLAlerts@rbl.bank.in` | Date only, no time |
| ICICI bank account | — | — | User couldn't find alerts yet; to follow |
| HDFC bank account | — | — | No sample yet |
| SBI, AMEX | — | — | Out of scope at the user's request |

What this means:
- Credit-card spending on HDFC, HSBC, ICICI and RBL can be captured automatically from Gmail.
- UPI payments made with the **HDFC RuPay credit card** are emailed, so they're capturable automatically.
- UPI payments from **bank accounts** (HDFC, ICICI savings) remain unproven: no bank-account
  alert samples yet. Those emails, if they arrive, are kept in the review queue until a parser
  is added.
- Senders use the new `.bank.in` domains, not the older addresses assumed above.

## 7. Strongest feasible design (what we will build)

1. Gmail adapter (automatic, primary).
2. iPhone SMS Message automation (automatic, supplementary), deduplicated against Gmail by
   account + amount + RRN/time window.
3. iPhone share-receipt Shortcut (user-triggered), for UPI payments with no bank alert. Mostly
   this adds the merchant name and app to a bank-alert transaction, or records UPI Lite payments.
4. Statement reconciliation (manual import). Fills gaps and measures true coverage.
5. Manual fallback entry, labelled as manual.

**Known remaining gap:** UPI Lite payments, and any bank that sends neither email nor SMS for UPI
debits, can only be recorded by a user action or statement import. The capture-status page will
show this gap instead of hiding it.

## Sources

- Apple: [Communication triggers in Shortcuts](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios), [Event triggers](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios), [Personal automations](https://support.apple.com/guide/shortcuts/create-a-new-personal-automation-apdfbdbd7123/ios), [What's new in Shortcuts 26](https://support.apple.com/en-us/125148)
- Reported: [iOS 26 Shortcuts automations: what's actually new](https://automatemylife.blog/ios-26-shortcuts-new-automations/), [Apple Developer Forums: bank SMS automation](https://developer.apple.com/forums/thread/705659)
- Google: [When is verification not needed](https://support.google.com/cloud/answer/13464323), [OAuth app verification](https://support.google.com/cloud/answer/13463073); 7-day Testing-mode refresh token expiry ([summary](https://www.unipile.com/google-oauth-refresh-token/))
