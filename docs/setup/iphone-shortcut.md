# iPhone Shortcut setup guide

Three Shortcuts send transactions from your iPhone to the tracker:

| Shortcut | How it runs | Recorded as | Status |
|---|---|---|---|
| **Quick Add**: type amount, payee, app | You tap it | Manual entry | Works |
| **Bank SMS forwarder**: a Messages automation | Automatically, when a bank SMS arrives | Automatic capture (once parsed) | SMS are received and kept for review; formats are parsed once real samples have been seen |
| **Send receipt**: share a PhonePe or Google Pay receipt | You share it after paying | User-triggered | Same as SMS: kept for review until a receipt format has been seen |

The Shortcuts never ask for, and the app never accepts, a UPI PIN, password, CVV or OTP.
OTP messages are ignored completely.

## Before you start

### 1. Create a key
In the app: **Settings → iPhone Shortcut keys → Create key** (name it e.g. "My iPhone"). Copy
the **Key** and the **Endpoint**. The key is shown once.

- The key only lets a Shortcut **send** transactions; it can't read anything.
- It's stored inside your Shortcuts, so **never share these Shortcuts** (or anything exported
  from them). If you do, or lose the phone, revoke the key in Settings. Shortcuts using it
  stop immediately.
- Each key is limited to 120 submissions an hour.

### 2. Make the app reachable from the phone
- **After deployment (Milestone 9):** the endpoint is `https://YOUR-DOMAIN/api/ingest/shortcut`.
  Use that.
- **For testing now, on home Wi-Fi:** run the app on the PC (`npm.cmd run app:start`), find the
  PC's address with `ipconfig` (the "IPv4 Address", e.g. `192.168.1.20`), and use
  `http://192.168.1.20:3000/api/ingest/shortcut` as the endpoint. Windows may ask whether to
  allow Node.js on private networks: allow it. This is plain HTTP on your own network, so only
  do it at home, and create a separate key for it that you revoke afterwards.

In every Shortcut below, **ENDPOINT** and **KEY** mean the values from step 1.

## Shortcut 1: Quick Add

Shortcuts app → **+** → name it **Log Expense**. Add these actions in order:

1. **Ask for Input**: type *Number*, prompt `Amount (₹)`.
2. **Ask for Input**: type *Text*, prompt `Paid to`.
3. **Choose from Menu** with prompt `Paid with`, items: `PhonePe`, `Google Pay`, `Paytm`,
   `Card`, `Cash`. (Optional; leave it out if you don't want the question.)
4. **Get Contents of URL**:
   - URL: **ENDPOINT**
   - Method: **POST**
   - Headers: `Authorization` = `Bearer KEY` (the word Bearer, a space, then the key)
   - Request Body: **JSON**, with fields:
     - `kind` (Text) = `quick_add`
     - `amount` (Number) = *Provided Input* from step 1
     - `merchant` (Text) = *Provided Input* from step 2
     - `paymentApp` (Text) = *Menu Result* (only if you kept step 3)
     - `id` (Text) = *Current Date*. This stops a double tap creating two entries.
5. **Get Dictionary Value**: get *Value* for key `message` in *Contents of URL*.
6. **Show Notification**: *Dictionary Value*.

Run it once. You should see "Saved.", and the expense appears under **Transactions** as
"Entered manually". Add it to your Home Screen or Action button for one-tap access.

## Shortcut 2: Bank SMS forwarder (automatic)

Shortcuts app → **Automation** → **+** → **Message**:

1. **Message Contains**: `debited`. (Create a second automation the same way for `spent`
   if your bank uses that word.) Optionally restrict **Sender** to your bank's SMS sender.
2. Choose **Run Immediately** and turn **Notify When Run** off.
3. **New Blank Automation**, then add **Get Contents of URL**:
   - URL **ENDPOINT**, Method **POST**, header `Authorization` = `Bearer KEY`
   - Request Body **JSON**:
     - `kind` (Text) = `sms`
     - `text` (Text) = *Shortcut Input* → tap it and choose **Content** (the message text)
     - `sender` (Text) = *Shortcut Input* → **Sender**

**Things to check on your phone** (feasibility tests I2 and I3):
- Does it run by itself, without asking you to tap? If iOS still asks every time, it isn't
  automatic on your iOS version. Tell me.
- In the app, **Automation → Needs a look** should show the SMS (with long numbers masked).
  Those first SMS are the samples I'll use to build each bank's SMS parser. After that, they're
  captured automatically.

## Shortcut 3: Send receipt (share sheet)

Shortcuts app → **+** → name it **Send Receipt** → tap the **ⓘ** (details) → turn on
**Show in Share Sheet**, and set input types to **Images** and **Text**. Then add:

1. **Extract Text from Image** from *Shortcut Input*. (If you share text rather than a
   screenshot, skip this step and use *Shortcut Input* below.)
2. **Get Contents of URL**: URL **ENDPOINT**, Method **POST**, header `Authorization` =
   `Bearer KEY`, Request Body **JSON**:
   - `kind` (Text) = `share`
   - `text` (Text) = *Text* (the extracted text)
3. **Get Dictionary Value** `message` → **Show Notification**.

Then, in PhonePe or Google Pay, open a payment → **Share** (or take a screenshot and share it)
→ **Send Receipt**. **Things to check** (feasibility test I4): does Send Receipt appear in the
share sheet, and does the shared item contain the amount and payee?

## What the app answers

Every request gets a JSON reply with `status` and a `message` you can show:

| status | Meaning |
|---|---|
| `captured` | Saved as a transaction |
| `duplicate` | Already received; nothing new saved |
| `needs_review` | Received, but no known format matched; waiting under Automation → Needs a look |
| `ignored` | Not a completed payment (e.g. an OTP); nothing kept |
| `queued` | Received; it will be processed within a minute |
| `error` | Wrong key (401), too many requests (429), or invalid input (400), with a reason |
