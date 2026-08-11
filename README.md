# The Ledger — setup guide

A tiny mobile-first web app that reads and writes your shared Google Sheet
directly from the browser. No backend server required — just these four
static files on your existing website:

```
index.html
style.css
app.js
config.js
```

---

## 1. Prepare the Google Sheet

Row 1 must be a header row. Data starts on row 2. Columns, in order:

| Col | Name           | Notes                                                        |
|-----|----------------|---------------------------------------------------------------|
| A   | Reference      | e.g. `John 3:16-21`                                            |
| B   | Added By       | free text. **Exception:** on the 3 rotating Sunday-reading rows (see below), this instead holds the role label — `First Reading`, `Second Reading`, or `Gospel`. |
| C   | Date Discussed | **blank** = still pending. The app writes `YYYY-MM-DD` when marked done, or `Skipped` when dismissed. |
| D   | Summary        | shown under the reference in the list. On Sunday rows this holds the liturgical day's name, e.g. "Nineteenth Sunday in Ordinary Time." |
| E   | Notes          | shown on the detail screen                                     |
| F   | Upvotes        | integer; leave blank or 0 to start                             |
| G   | Downvotes      | integer; leave blank or 0 to start                              |
| H   | Category       | leave **blank** for regular entries. The Sunday-readings script sets this to `Sunday` for its 3 rows so the app can badge and label them. Add this column if it doesn't exist yet. |

If your existing sheet doesn't have Upvotes/Downvotes/Category columns yet,
add them now as columns F, G, and H.

**Share the sheet** with each of your 12 users individually (Share button →
add each person's Google account email → **Editor** access). Each person
signs into the app with the same Google account you shared it with.

---

## 2. Create a Google Cloud project + OAuth credentials

This is a one-time setup, done by whoever administers the app.

1. Go to **https://console.cloud.google.com/** and create a new project
   (top-left project dropdown → New Project). Any name is fine.
2. In the left sidebar: **APIs & Services → Library**. Search for and
   **Enable** each of:
   - **Google Sheets API**
   - **Google Picker API**
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (this is fine for a small private group).
   - Fill in the app name (e.g. "The Ledger"), your email as support/contact.
   - Scopes: you can skip adding scopes here — the app requests them at
     sign-in time.
   - **Test users**: add the Google account email of each of your 12 users.
     Leave the app in **Testing** status — you do not need to submit it for
     verification for a private group like this.
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: anything, e.g. "Ledger web app".
   - **Authorized JavaScript origins**: add the exact URL your site will be
     served from, e.g. `https://yourdomain.com` (no trailing slash, must be
     `https`, not `http`).
   - Leave "Authorized redirect URIs" empty — this app doesn't use redirects.
   - Click **Create**. Copy the **Client ID** shown (ends in
     `.apps.googleusercontent.com`).
5. **APIs & Services → Credentials → + Create Credentials → API key**:
   - This is a separate credential from the Client ID above — it's what the
     Picker (the "choose your sheet" step) uses.
   - Once created, click into it and set:
     - **API restrictions**: restrict key → select **Google Picker API** only.
     - **Application restrictions**: **HTTP referrers** → add your site's
       URL, e.g. `https://yourdomain.com/*`.
   - Copy the API key shown.

---

## 3. Fill in `config.js`

Open `config.js` and fill in:

```js
window.APP_CONFIG = {
  CLIENT_ID: "...apps.googleusercontent.com",   // from step 2.4
  SPREADSHEET_ID: "...",                         // from your sheet's URL
  PICKER_API_KEY: "...",                         // from step 2.5
  SHEET_NAME: "Sheet1",                          // the tab name
  BIBLE_TRANSLATION: "kjv"
};
```

The `SPREADSHEET_ID` is the long string in your sheet's URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

---

## 4. Upload the files

Upload all four files (`index.html`, `style.css`, `app.js`, `config.js`) to
your website, served over **HTTPS** — Google's sign-in requires it. They can
sit in a subfolder, e.g. `yourdomain.com/ledger/`.

That's it — visit the page on a phone and sign in.

---

## How it behaves

- **Signing in** the very first time (per browser) shows one extra step:
  choosing your sheet from a Google file picker. This is what grants the
  app access to that one file specifically, instead of your whole Drive —
  see "Access scope" below. After that first pick, it's remembered and you
  won't see it again unless you switch browsers/devices or clear site data.
- **List screen** shows every row where "Date Discussed" is blank.
  Reference in bold, summary underneath.
- **Swipe a row left or right** to downvote / upvote it. This writes
  straight to the Upvotes/Downvotes column in the sheet. Swiping up or down
  just scrolls the list as normal.
- **Tap a row** to open the detail screen: full passage text (fetched live
  from a free public Bible API using the reference — see below), summary,
  notes, and two buttons.
  - **Mark discussed** writes today's date into "Date Discussed."
  - **Not now** writes `Skipped` into "Date Discussed" — it drops off the
    pending list but the row stays in the sheet (nothing is deleted).
- **The + button** on the list screen opens a form to add a new passage —
  reference (required), added-by, summary, and notes. It appends a row to
  the sheet and refreshes the list. "Added by" is prefilled with the signed-in
  Google account's name, but stays editable — if you type over it, that
  override is remembered in the browser (not synced across devices) for next
  time.

## Access scope

The app requests Google's `drive.file` permission rather than full Sheets
access — Google's consent screen describes this as access to "the specific
Google Drive files you use with this app," and it's enforced, not just
cosmetic. The one-time file picker step is what grants access to your
specific shared sheet; the app can't read or touch anything else in anyone's
Drive. If a person picks the wrong file by mistake, the app checks the ID
against your configured `SPREADSHEET_ID` and asks them to pick again rather
than silently using the wrong sheet.

## Known simplifications, worth knowing about

- **Votes are a shared counter**, not tied to who voted — anyone can swipe
  the same entry more than once. If you want one-vote-per-person later, that
  needs a per-user tracking column (e.g. a comma list of voter names) rather
  than a simple number.
- **Passage text** comes from `bible-api.com`, a free public-domain-only
  Bible text API, matched against whatever's in your Reference column. If a
  reference doesn't parse cleanly (unusual abbreviations, etc.) the app
  shows a friendly fallback message instead of the verse text — the summary
  and notes still show normally. You can swap in a different Bible text API
  or your own stored text later if this matters.
- **Sign-in sessions**: because the app is in Google's "Testing" mode (fine
  for 12 known users), each person may occasionally need to click through an
  "unverified app" warning screen and re-sign-in every so often — there's no
  account to submit for verification with this small a user base, so this is
  expected rather than a bug.
- **"Added by" on the add form** is prefilled from the signed-in Google
  account's name, but it's a plain editable text field underneath — nothing
  stops someone from typing over it with a different name.
- **Requesting an extra permission**: the app now asks for a `profile`
  scope (just enough to read the account's display name) in addition to
  Sheets access. Existing testers will see one extra line on the Google
  consent screen the next time they sign in — a one-time thing, nothing to
  set up.

## Extending later

- Per-user vote tracking: store voter emails/names in a delimited cell, or
  add one column per user.
- Sorting the pending list by votes, date added, etc.

---

## Optional: automatic Sunday readings

`apps-script/sunday-readings.gs` is a small script you can attach directly
to the Google Sheet (separate from the web app) that keeps 3 rows in the
sheet — First Reading, Second Reading, Gospel — updated to the upcoming (or
current) Sunday's Mass readings, sourced from USCCB's daily readings pages.
Each week it overwrites those 3 rows in place with the new citations and
resets their votes and "date discussed" status, since it's new content.

**Setup:**
1. Add the `Category` column (H) to your sheet if it isn't there yet.
2. Open your Sheet → **Extensions → Apps Script**.
3. Delete the starter code and paste in the contents of
   `apps-script/sunday-readings.gs`.
4. Double check the `SHEET_NAME` constant at the top matches your sheet
   tab's name (same value as `SHEET_NAME` in the web app's `config.js`).
5. Run the `updateSundayReadings` function once manually (▶ Run button) to
   authorize it and confirm it works — check **View → Executions** for logs,
   especially any "couldn't parse" warnings.
6. Set up the weekly trigger: click the **clock icon (Triggers)** in the
   left sidebar → **+ Add Trigger** → function `updateSundayReadings`,
   event source **Time-driven**, type **Week timer**, pick a day (Monday
   works well, right after the current Sunday has passed) and a time
   window. Save.

**Known limitations:**
- This relies on USCCB's page structure staying the same. If they redesign
  their site, the parsing may silently fail on a heading — the script logs
  a warning and leaves the existing row untouched rather than overwriting
  good data with a blank, but it's worth glancing at the trigger's
  execution history occasionally.
- It fetches the readings citations only — not the actual copyrighted
  reading text from USCCB's own page. The web app fetches the actual verse
  text separately via bible-api.com, same as your other entries.
- The three rows are matched by the combination of `Category = Sunday` and
  the role label in column B. Don't hand-edit those two fields on the
  Sunday rows, or the script will lose track of them and create duplicates
  instead of updating in place.
