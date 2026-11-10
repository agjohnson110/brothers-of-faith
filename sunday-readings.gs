/**
 * The Scripture Library — Sunday Readings updater
 * ------------------------------------
 * Bound Apps Script for your Google Sheet. On a weekly trigger, this fetches
 * the upcoming (or current, if run on a Sunday) Sunday's readings from
 * USCCB's daily readings page and writes/overwrites three rows in the sheet:
 * First Reading, Second Reading, and Gospel — marked with Category="Sunday"
 * so the web app can label them distinctly.
 *
 * SETUP
 * 1. Open your Sheet -> Extensions -> Apps Script.
 * 2. Add a new script file and paste this whole file in, keeping the library API file.
 * 3. Update SHEET_NAME below if your tab isn't called "Sheet1".
 * 4. Run `updateSundayReadings` once manually (Run button) to authorize it
 *    and confirm it works. Check View -> Logs (or View -> Executions) for
 *    output, especially any "Couldn't parse" warnings.
 * 5. Set up the weekly trigger: click the clock icon (Triggers) in the left
 *    sidebar -> + Add Trigger -> function: updateSundayReadings,
 *    event source: Time-driven, type: Week timer, pick a day (e.g. Monday)
 *    and a time window (e.g. 1am–2am). Save.
 *
 * SHEET COLUMNS EXPECTED (same as the web app):
 *   A Reference | B Added By / Role | C Date Discussed | D Summary |
 *   E Notes | F Upvotes | G Downvotes | H Category
 */

const SHEET_NAME = "Sheet1"; // keep in sync with LIBRARY_SHEET_NAME in library-api.gs

function updateSundayReadings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log(`Sheet tab "${SHEET_NAME}" not found.`);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const targetSunday = getUpcomingOrCurrentSunday_(tz);
  const dateStr = Utilities.formatDate(targetSunday, tz, "MMddyy");
  const url = `https://bible.usccb.org/bible/readings/${dateStr}.cfm`;

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log(`Fetch failed for ${url} — status ${res.getResponseCode()}`);
    return;
  }
  const html = res.getContentText();

  const sundayName = decodeHtmlEntities_(
    extractBetween_(html, /<title>(.*?)\s*\|\s*USCCB/i)
  );
  let reading1 = decodeHtmlEntities_(extractCitationAfterLabel_(html, "Reading 1"));
  let reading2 = decodeHtmlEntities_(extractCitationAfterLabel_(html, "Reading 2"));
  let gospel = decodeHtmlEntities_(extractCitationAfterLabel_(html, "Gospel"));

  // Fallback: if label-text matching didn't work (e.g. the heading text is
  // split across nested tags), fall back to the citation links themselves,
  // which link to URLs like /bible/1kings/19?9 in a fixed document order:
  // Reading 1, Responsorial Psalm, Reading 2, Alleluia, Gospel.
  if (!reading1 || !reading2 || !gospel) {
    const hrefCitations = extractCitationsByHref_(html);
    Logger.log(`Fallback: found ${hrefCitations.length} bible.usccb.org citation links: ${JSON.stringify(hrefCitations)}`);
    if (hrefCitations.length === 5) {
      if (!reading1) reading1 = hrefCitations[0];
      if (!reading2) reading2 = hrefCitations[2];
      if (!gospel) gospel = hrefCitations[4];
    } else if (hrefCitations.length === 4) {
      // some days omit a separate Alleluia-verse citation link
      if (!reading1) reading1 = hrefCitations[0];
      if (!reading2) reading2 = hrefCitations[2];
      if (!gospel) gospel = hrefCitations[3];
    }
  }

  // Still stuck? Dump a raw snippet around the word "Reading" so the actual
  // markup can be inspected and the label matching fixed precisely.
  if (!reading1 || !reading2 || !gospel) {
    const idx = html.search(/reading/i);
    if (idx !== -1) {
      Logger.log(`Raw HTML snippet near first "reading" match, for diagnosis:\n${html.slice(idx - 50, idx + 600)}`);
    } else {
      Logger.log(`The word "reading" doesn't appear anywhere in the fetched HTML — the page may have failed to render or redirected.`);
    }
  }

  Logger.log(`${dateStr} — ${sundayName || "(name not parsed)"}`);
  Logger.log(`Reading 1: ${reading1 || "(not parsed)"}`);
  Logger.log(`Reading 2: ${reading2 || "(not parsed)"}`);
  Logger.log(`Gospel: ${gospel || "(not parsed)"}`);

  const items = [
    { role: "First Reading", reference: reading1 },
    { role: "Second Reading", reference: reading2 },
    { role: "Gospel", reference: gospel },
  ];

  items.forEach((item) => {
    if (!item.reference) {
      Logger.log(`Skipping "${item.role}" — couldn't parse a reference, leaving existing row untouched.`);
      return;
    }
    upsertSundayRow_(sheet, item.role, item.reference, sundayName || "");
  });
}

// ---- helpers ----

function getUpcomingOrCurrentSunday_(tz) {
  // IMPORTANT: don't use now.getDay()/now.getDate()/now.setDate() here.
  // Those are JS Date local getters/setters, which resolve to the Apps
  // Script *project's* default timezone (appsscript.json), not
  // necessarily the spreadsheet's timezone. Since the caller later
  // formats the result with Utilities.formatDate(..., tz, ...) using the
  // SPREADSHEET's timezone, mixing the two can silently roll the result
  // onto the wrong calendar day — especially when the trigger fires close
  // to midnight, which is exactly the failure this fixes (a Monday
  // 12:40 AM run landing on Saturday instead of the following Sunday).
  //
  // Instead, do everything in terms of `tz` explicitly: get today's
  // ISO weekday number ("u": 1=Mon...7=Sun) as rendered in `tz`, then
  // add days to a date string anchored at noon UTC (safely clear of any
  // timezone offset ever pushing it across a day boundary) before
  // formatting the result back out in `tz`.
  const now = new Date();
  const isoDow = Number(Utilities.formatDate(now, tz, "u")); // 1..7, 7=Sunday
  const daysUntilSunday = isoDow === 7 ? 0 : 7 - isoDow;

  const todayStr = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const [y, m, d] = todayStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC, DST/offset-safe
  anchor.setUTCDate(anchor.getUTCDate() + daysUntilSunday);
  return anchor;
}

function extractBetween_(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : "";
}

function extractCitationAfterLabel_(html, label) {
  // Don't assume the heading text sits immediately between '>' and '<' —
  // real markup often has whitespace, a newline, or a wrapping <span>
  // around it. Search for the label text anywhere (tolerant of internal
  // whitespace/&nbsp;), then take the first citation link after it.
  const normalized = html.replace(/&nbsp;/gi, " ");
  const labelPattern = label.replace(/\s+/g, "\\s+");
  const labelRegex = new RegExp(labelPattern, "i");
  const match = labelRegex.exec(normalized);
  if (!match) return "";

  const windowEnd = Math.min(normalized.length, match.index + 2000);
  const rest = normalized.slice(match.index, windowEnd);
  const anchorMatch = rest.match(/<a\b[^>]*>([^<]+)<\/a>/i);
  return anchorMatch ? anchorMatch[1].trim() : "";
}

function extractCitationsByHref_(html) {
  // Citation links point at URLs like /bible/1kings/19?9 — matching on that
  // URL shape is more robust than matching heading text, since it doesn't
  // depend on how the surrounding markup/whitespace is structured.
  const regex = /<a\b[^>]*href="[^"]*\/bible\/[a-z0-9]+\/\d+\?[^"]*"[^>]*>([^<]+)<\/a>/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(decodeHtmlEntities_(m[1].trim()));
  }
  return matches;
}

function decodeHtmlEntities_(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&nbsp;/g, " ");
}

function upsertSundayRow_(sheet, role, reference, sundayName) {
  const data = sheet.getDataRange().getValues();
  let targetRow = -1; // 1-indexed sheet row number

  for (let i = 1; i < data.length; i++) {
    // skip header row (index 0)
    const category = (data[i][7] || "").toString().trim(); // column H
    const roleCell = (data[i][1] || "").toString().trim(); // column B
    if (category === "Sunday" && roleCell === role) {
      targetRow = i + 1;
      break;
    }
  }

  // Reference, Role, Date Discussed (reset), Summary (Sunday name),
  // Notes (blank), Upvotes (reset), Downvotes (reset), Category
  const rowValues = [reference, role, "", sundayName, "", 0, 0, "Sunday"];

  if (targetRow === -1) {
    sheet.appendRow(rowValues);
    Logger.log(`Added new row for "${role}".`);
  } else {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
    Logger.log(`Updated existing row ${targetRow} for "${role}".`);
  }
}
