# "Explain payments" Shortcut

Your iPhone asks you, for each new payment, **which category** it belongs to and **why** you
made it. The question appears over whatever app you're using, at the times you choose in
**Settings → Explain prompts** (default 9:00, 12:00, 15:00, 18:00, 21:00). If your phone is
locked or you skip, it asks again after 15 minutes. Anything you never answer waits on the
**To explain** page in the app.

How it works: the app keeps the schedule. The phone asks the app "is anything due?" every
time you open one of your everyday apps. If nothing is due, the Shortcut ends silently in
under a second.

You need the device key from **Settings → iPhone Shortcut keys** (the same one Quick Add uses
is fine). Until the app is on a server, this only works on your home Wi-Fi; away from home it
ends silently and asks later.

In the steps, `APP` is the app address you already use for Quick Add, e.g.
`http://192.168.1.20:3000`.

## 1. Build the Shortcut

Shortcuts app → **+** → name it **Explain payments**. Add these actions in order.

1. **Get Contents of URL**
   - URL: `APP/api/ingest/explain`
   - Method: **GET**
   - Headers: add `Authorization` = `Bearer etk_…your key…`
2. **Get Dictionary Value**: Get **Value** for key `count` in *Contents of URL*.
3. **If** *Dictionary Value* **is** `0` → add **Stop This Shortcut** inside the If. (Leave
   Otherwise empty; delete the "Otherwise" part if you like.) After **End If**:
4. **Get Dictionary Value**: Get **Value** for key `items` in *Contents of URL* (tap the
   input → Select Variable → the first action). Keys are lowercase.
5. **Repeat with Each** item in the *Dictionary Value* from step 4. Tap and hold the chip to
   check it highlights the `items` action, not the `count` one; if the Repeat runs over the
   count, every item is a number and the steps below fail. Inside the repeat:
   1. **Get Dictionary from Input** with *Repeat Item*. Then **Set Variable** `Payment` to it.
   2. **Get Dictionary Value**: key `label` in `Payment`. Then **Set Variable** `Label` to it.
      The label reads like `₹160.00 · SRINIDHI UPACHAR · HSBC Credit Card ••5468 · Today
      10:18 am`, or `… · UPI · …` when the account doesn't say how it was paid.
   3. **Get Dictionary Value**: key `categories` in `Payment`.
   4. **Choose from List**: list = that *Dictionary Value*; tap the action's arrow →
      **Prompt** = the `Label` variable (a blue chip, not typed text). (The first entry is the
      payment's current category, if it has one.) Then **Set Variable** `Category` to *Chosen Item*.
   5. **List** with your "why" options, one per item (e.g. `Rakshith Personal`, `Shared Rental
      Expense`, `Home Expense`).
   6. **Choose from List**: list = that *List*; **Prompt** = `Label`, a new line, `Why?`. Then
      **Set Variable** `Reason` to *Chosen Item*. (For a free-text reason use **Ask for Input**
      instead, with the same prompt.)
   7. **Get Dictionary Value**: key `id` in `Payment`.
   8. **Get Contents of URL**
      - URL: `APP/api/ingest/explain?format=text`
      - Method: **POST**, Request Body: **JSON**, with fields:
        - `id` (Text) = *Dictionary Value* (from step 5.7)
        - `category` (Text) = `Category`
        - `reason` (Text) = `Reason`
      - Headers: `Authorization` = `Bearer etk_…your key…`
   9. **Show Notification** *Contents of URL* (shows "Saved: …").
6. After **End Repeat**: **Show Notification** `Thanks, all explained` (optional).

The reasons you pick appear in **Transactions → Filters → Why**, so you can list (and export)
everything for, say, "Shared Rental Expense". Adding an option to the List is enough; it shows
in the filter once a payment has used it.

To skip a payment, cancel its list (swipe down or tap ✕). The rest of that batch is skipped too
and comes back after 15 minutes. Run the Shortcut by hand to answer immediately, ignoring the
schedule: duplicate it, and in its first action use `APP/api/ingest/explain?manual=1`.

## 2. Automations: "when I open an app"

Shortcuts → **Automation** → **+** → **App** → choose the apps you open most (for example
WhatsApp, Instagram, Chrome, PhonePe, Google Pay; you can pick several in one automation)
→ tick **Is Opened** → **Run Immediately** → turn **off** **Notify When Run** → **Next** →
choose **Explain payments**.

This is what makes it wait until you unlock: the first of these apps you open after a
scheduled time shows the questions.

## 3. Optional: at the scheduled times

Only if you also want it at the exact times while the phone is in use: **Automation → + →
Time of Day** (e.g. 15:00, Daily) → **Run Immediately**, **Notify When Run** off → **Explain
payments**. Repeat for each time. If the phone is locked then, nothing is lost: it shows the
next time you open one of your apps (after the retry interval).

## Checking it works

1. Make a small payment (or add one with Quick Add).
2. In the app, **Settings → Explain prompts**, set a time a couple of minutes from now and save.
3. After that time, open one of your chosen apps. The questions should appear over it.
4. The payment now shows your category and reason, and is gone from **To explain**.

## What the key can do now

The device key can send transactions (as before), read the payments waiting to be explained
(amount, payee, account, time) and the category names, and answer those payments. It can't
read anything else. Revoke it in Settings if the phone is lost.
