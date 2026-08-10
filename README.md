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
| B   | Added By       | free text                                                      |
| C   | Date Discussed | **blank** = still pending. The app writes `YYYY-MM-DD` when marked done, or `Skipped` when dismissed. |
| D   | Summary        | shown under the reference in the list                          |
| E   | Notes          | shown on the detail screen                                     |
| F   | Upvotes        | integer; leave blank or 0 to start                             |
| G   | Downvotes      | integer; leave blank or 0 to start                              |

If your existing sheet doesn't have Upvotes/Downvotes columns yet, add them
now as columns F and G.

**Share the sheet** with each of your 12 users individually (Share button →
add each person's Google account email → **Editor** access). Each person
signs into the app with the same Google account you shared it with.

---

## 2. Create a Google Cloud project + OAuth credentials

This is a one-time setup, done by whoever administers the app.

1. Go to **https://console.cloud.google.com/** and create a new project
   (top-left project dropdown → New Project). Any name is fine.
2. In the left sidebar: **APIs & Services → Library**. Search for
   **Google Sheets API** and click **Enable**.
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

---

## 3. Fill in `config.js`

Open `config.js` and fill in:

```js
window.APP_CONFIG = {
  CLIENT_ID: "...apps.googleusercontent.com",   // from step 2
  SPREADSHEET_ID: "...",                         // from your sheet's URL
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
- **Adding new entries** from the app isn't built yet, per your note — the
  sheet itself remains the way to add new passages for now.

## Extending later

- Adding new entries from the app: a simple form screen that appends a row
  via `spreadsheets.values.append`.
- Per-user vote tracking: store voter emails/names in a delimited cell, or
  add one column per user.
- Sorting the pending list by votes, date added, etc.
