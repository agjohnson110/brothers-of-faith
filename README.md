# The Ledger — setup guide

A tiny mobile-first web app that reads and writes your Google Sheet through
a bound Apps Script web app. The browser app consists of these four static
files on your existing website:

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

## 2. Install and deploy the Apps Script API

The API runs as a script bound to the target spreadsheet. It performs all
sheet reads and writes, so the users do not need individual spreadsheet
access.

1. Open the target spreadsheet and choose **Extensions → Apps Script**.
2. Add a script file named `library-api.gs` and paste in the contents of
   this repository's `library-api.gs`. Set `LIBRARY_SHEET_NAME` near the top
   to the exact tab name containing the library.
3. In Apps Script, open **Project Settings → Script Properties** and add
   `API_SECRET` with the shared secret value. Use a long, unique secret and
   do not put it in `config.js` or in the script source.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to your
   account and **Who has access** to **Anyone**. Deploy and authorize the
   script. Copy the web app URL ending in `/exec`.
5. In `config.js`, set `API_URL` to that `/exec` URL. Confirm
   `LIBRARY_SHEET_NAME` matches the spreadsheet tab. If you use the optional
   Sunday-readings automation, set its `SHEET_NAME` to the same tab.
6. Upload `index.html`, `style.css`, `app.js`, and `config.js` to your site.
   Serve the app over HTTPS and sign in with a username and the shared secret.

When the Apps Script code changes, create a new deployment version and update
the URL in `config.js` if Apps Script provides a new deployment URL.

**Important:** this is a shared-secret gate, not individual account
authentication. The secret is stored in each signed-in browser and sent to
the web app API, so every person who has it can access the spreadsheet through
the app. Use a unique secret, share it only with trusted users, and rotate it
in Script Properties if it is exposed.

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
- **The + button** on the list screen opens a form to add a new passage —
  reference (required), added-by, summary, and notes. It appends a row to
  the sheet and refreshes the list. "Added by" is prefilled with the signed-in
  username, but stays editable; the edited value is remembered locally.

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
- **Usernames are labels, not separate accounts.** Anyone with the common
  secret can enter any username; the app uses it to prefill "Added by."

## Extending later

- Per-user vote tracking: store voter emails/names in a delimited cell, or
  add one column per user.
- Sorting the pending list by votes, date added, etc.

---

## Optional: automatic Sunday readings

`sunday-readings.gs` is a small script you can attach directly
to the Google Sheet (separate from the web app) that keeps 3 rows in the
sheet — First Reading, Second Reading, Gospel — updated to the upcoming (or
current) Sunday's Mass readings, sourced from USCCB's daily readings pages.
Each week it overwrites those 3 rows in place with the new citations and
resets their votes and "date discussed" status, since it's new content.

**Setup:**
1. Add the `Category` column (H) to your sheet if it isn't there yet.
2. Open your Sheet → **Extensions → Apps Script**.
3. Add a script file named `sunday-readings.gs` and paste in its contents.
   Keep the library API script in the project; do not replace it.
4. Double check the `SHEET_NAME` constant at the top matches your sheet
   tab's name and `LIBRARY_SHEET_NAME` in `library-api.gs`.
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


## Testing
1. Run a local server in root directory: `python -m http.server 8000` in VS Code terminal
2. Open `http://localhost:8000` in your browser
3. For mobile: Access the IP of your machine on port 8000
4. Use ctrl-shift-R for windows hard refresh
