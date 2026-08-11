// ============================================================
// The Ledger — app.js
// A thin mobile front end over a shared Google Sheet.
//
// Sheet columns expected (row 1 = header, data starts row 2):
//   A: Reference        e.g. "John 3:16-21"
//   B: Added By          e.g. "Dana"
//   C: Date Discussed    blank = pending, "Skipped" = dismissed,
//                         otherwise YYYY-MM-DD = done
//   D: Summary
//   E: Notes
//   F: Upvotes           integer, may start blank
//   G: Downvotes         integer, may start blank
// ============================================================

const CFG = window.APP_CONFIG;
const SHEET_RANGE_READ = `${CFG.SHEET_NAME}!A2:H`;
const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SPREADSHEET_ID}`;

let accessToken = null;
let tokenClient = null;
let rows = []; // { rowNumber, reference, addedBy, dateDiscussed, summary, notes, upvotes, downvotes }

const $ = (id) => document.getElementById(id);

const screens = {
  signin: $("screen-signin"),
  picker: $("screen-picker"),
  list: $("screen-list"),
  detail: $("screen-detail"),
  add: $("screen-add"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
}

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.style.borderColor = isError ? "var(--brick)" : "var(--ink-line)";
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.hidden = true), 2600);
}

// ============================================================
// AUTH
// ============================================================
let googleDisplayName = ""; // from the signed-in Google account, used to prefill "Added by"

function fileGrantedKey() {
  // Keyed by SPREADSHEET_ID so switching sheets in config.js correctly
  // asks for a fresh pick instead of reusing a stale grant.
  return `ledger_file_granted_${CFG.SPREADSHEET_ID}`;
}

function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.CLIENT_ID,
    // drive.file: access limited to files the person explicitly selects via
    // the Picker below (or files this app itself creates) — not their whole
    // Drive. userinfo.profile: just enough to prefill "Added by".
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile",
    callback: (resp) => {
      if (resp.error) {
        $("signin-error").hidden = false;
        $("signin-error").textContent = "Sign-in failed. Please try again.";
        return;
      }
      accessToken = resp.access_token;
      sessionStorage.setItem("ledger_token", accessToken);
      proceedAfterAuth();
    },
  });

  // Reuse a token from earlier this session, if we have one.
  const saved = sessionStorage.getItem("ledger_token");
  if (saved) {
    accessToken = saved;
    proceedAfterAuth(true);
  }
}

function proceedAfterAuth(isRestoredSession = false) {
  if (localStorage.getItem(fileGrantedKey())) {
    enterApp(isRestoredSession);
  } else {
    $("picker-error").hidden = true;
    showScreen("picker");
  }
}

async function fetchGoogleDisplayName() {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`userinfo ${res.status}`);
    const data = await res.json();
    googleDisplayName = data.name || data.email || "";
  } catch (err) {
    console.error(err);
    googleDisplayName = ""; // the add form just falls back to a blank/remembered field
  }
}

function signIn() {
  tokenClient.requestAccessToken({ prompt: "" });
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  googleDisplayName = "";
  sessionStorage.removeItem("ledger_token");
  showScreen("signin");
}

async function enterApp(isRestoredSession = false) {
  showScreen("list");
  await Promise.all([loadSheet(isRestoredSession), fetchGoogleDisplayName()]);
}

// ============================================================
// PICKER — one-time per-file access grant (drive.file scope)
// ============================================================
let pickerApiLoaded = false;

function ensurePickerLoaded(cb) {
  if (pickerApiLoaded) {
    cb();
    return;
  }
  if (!window.gapi) {
    // apis.google.com/js/api.js loads async — retry briefly if it's not
    // ready yet rather than failing outright.
    setTimeout(() => ensurePickerLoaded(cb), 100);
    return;
  }
  gapi.load("picker", () => {
    pickerApiLoaded = true;
    cb();
  });
}

function openPicker() {
  $("picker-error").hidden = true;
  ensurePickerLoaded(() => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setEnableDrives(true); // required to correctly resolve files inside Shared Drives / shared folders
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(accessToken)
      .setDeveloperKey(CFG.PICKER_API_KEY)
      .setCallback(onPickerResult)
      .build();
    picker.setVisible(true);
  });
}

function onPickerResult(data) {
  if (data.action !== google.picker.Action.PICKED) return;
  const doc = data.docs[0];
  if (doc.id === CFG.SPREADSHEET_ID) {
    localStorage.setItem(fileGrantedKey(), "1");
    enterApp();
  } else {
    $("picker-error").hidden = false;
    $("picker-error").textContent =
      "That's not the shared group sheet — please choose the correct one.";
  }
}

// ============================================================
// SHEETS API
// ============================================================
async function sheetsFetch(path, options = {}) {
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    // token expired mid-session — send back to sign-in
    accessToken = null;
    sessionStorage.removeItem("ledger_token");
    showScreen("signin");
    $("signin-error").hidden = false;
    $("signin-error").textContent = "Your session expired. Please sign in again.";
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    // With drive.file scope, this means the per-file access grant was
    // lost or never completed — send back through the picker to re-grant.
    localStorage.removeItem(fileGrantedKey());
    showScreen("picker");
    $("picker-error").hidden = false;
    $("picker-error").textContent = "Access to the sheet was lost — please choose it again.";
    throw new Error("PermissionDenied");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function loadSheet(quiet = false) {
  const status = $("list-status");
  const listEl = $("list");
  if (!quiet) {
    status.hidden = false;
    status.textContent = "Loading passages…";
    listEl.hidden = true;
  }
  try {
    const data = await sheetsFetch(
      `/values/${encodeURIComponent(SHEET_RANGE_READ)}`
    );
    const values = data.values || [];
    rows = values.map((r, i) => ({
      rowNumber: i + 2, // sheet row, since data starts at row 2
      reference: (r[0] || "").trim(),
      addedBy: (r[1] || "").trim(), // for Category="Sunday" rows, holds the role label instead
      dateDiscussed: (r[2] || "").trim(),
      summary: (r[3] || "").trim(),
      notes: (r[4] || "").trim(),
      upvotes: parseInt(r[5], 10) || 0,
      downvotes: parseInt(r[6], 10) || 0,
      category: (r[7] || "").trim(),
    }));
    // Sort by score (upvotes minus downvotes), highest first. This order is
    // only recomputed here — on load and on manual refresh — so local
    // swipe-voting doesn't reshuffle the list mid-session.
    rows.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    status.hidden = true;
    renderList();
  } catch (err) {
    console.error(err);
    if (err.message !== "Unauthorized") {
      status.hidden = false;
      status.textContent = "Couldn't load the sheet. Pull down to try again.";
    }
  }
}

async function updateCell(a1, value) {
  await sheetsFetch(
    `/values/${encodeURIComponent(CFG.SHEET_NAME + "!" + a1)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[value]] }),
    }
  );
}

async function appendRow(rowValues) {
  // NB: only the range portion is encoded — ":append" must stay literal,
  // it's part of the Sheets API's method-on-resource path syntax.
  await sheetsFetch(
    `/values/${encodeURIComponent(CFG.SHEET_NAME + "!A:H")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [rowValues] }),
    }
  );
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ============================================================
// LIST RENDERING
// ============================================================
function pendingRows() {
  return rows.filter((r) => r.dateDiscussed === "");
}

function renderList() {
  const listEl = $("list");
  const empty = $("empty-state");
  const pending = pendingRows();

  listEl.innerHTML = "";

  if (pending.length === 0) {
    listEl.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  listEl.hidden = false;

  pending.forEach((row) => listEl.appendChild(buildRowEl(row)));
}

function buildRowEl(row) {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.rowNumber = row.rowNumber;
  const isSunday = row.category === "Sunday";

  li.innerHTML = `
    <div class="row-flag row-flag-left">＋</div>
    <div class="row-flag row-flag-right">－</div>
    <div class="row-card">
      <div class="row-votes"><span class="up">↑${row.upvotes}</span><span class="down">↓${row.downvotes}</span></div>
      ${isSunday ? '<div class="row-badge">Sunday</div>' : ""}
      <div class="row-reference"></div>
      <div class="row-summary"></div>
      <div class="row-meta"></div>
    </div>
  `;

  li.querySelector(".row-reference").textContent = row.reference || "(untitled passage)";
  li.querySelector(".row-summary").textContent = row.summary || "No summary yet.";
  li.querySelector(".row-meta").textContent = isSunday
    ? row.addedBy // role label, e.g. "First Reading"
    : row.addedBy
    ? `added by ${row.addedBy}`
    : "";

  attachSwipeHandlers(li, row);

  li.querySelector(".row-card").addEventListener("click", (e) => {
    if (li.dataset.suppressClick === "1") {
      li.dataset.suppressClick = "0";
      return;
    }
    openDetail(row);
  });

  return li;
}

// ============================================================
// SWIPE GESTURES
//   left/right on a row  -> downvote / upvote
//   up/down on a row     -> let it fall through as normal scroll
// ============================================================
const SWIPE_VOTE_THRESHOLD = 70; // px of horizontal drag to commit a vote
const SWIPE_INTENT_RATIO = 1.3;  // how much more horizontal than vertical to count as a swipe

function attachSwipeHandlers(li, row) {
  const card = li.querySelector(".row-card");
  const leftFlag = li.querySelector(".row-flag-left");
  const rightFlag = li.querySelector(".row-flag-right");
  let startX = 0,
    startY = 0,
    dx = 0,
    dy = 0,
    dragging = false,
    decided = false,
    isHorizontal = false;

  const resetFlags = () => {
    leftFlag.style.opacity = 0;
    rightFlag.style.opacity = 0;
  };

  const onStart = (x, y) => {
    startX = x;
    startY = y;
    dx = 0;
    dy = 0;
    dragging = true;
    decided = false;
    card.style.transition = "none";
  };

  const onMove = (x, y, evt) => {
    if (!dragging) return;
    dx = x - startX;
    dy = y - startY;

    if (!decided) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        isHorizontal = Math.abs(dx) > Math.abs(dy) * SWIPE_INTENT_RATIO;
        decided = true;
      } else {
        return;
      }
    }

    if (isHorizontal) {
      if (evt && evt.cancelable) evt.preventDefault();
      card.style.transform = `translateX(${dx}px)`;
      // only the flag matching the current drag direction should be visible
      const reveal = Math.min(Math.abs(dx) / SWIPE_VOTE_THRESHOLD, 1);
      if (dx > 0) {
        leftFlag.style.opacity = reveal;
        rightFlag.style.opacity = 0;
      } else {
        rightFlag.style.opacity = reveal;
        leftFlag.style.opacity = 0;
      }
    }
    // if vertical, we do nothing and let the page scroll natively
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = "transform 0.18s ease";

    if (isHorizontal && Math.abs(dx) > SWIPE_VOTE_THRESHOLD) {
      li.dataset.suppressClick = "1";
      const direction = dx > 0 ? "up" : "down";
      castVote(row, direction, li);
    }
    card.style.transform = "translateX(0)";
    resetFlags();
    isHorizontal = false;
    decided = false;
  };

  // Touch
  card.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });

  card.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY, e);
  }, { passive: false });

  card.addEventListener("touchend", onEnd);
  card.addEventListener("touchcancel", onEnd);

  // Mouse (for desktop testing)
  card.addEventListener("mousedown", (e) => onStart(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => {
    if (dragging) onMove(e.clientX, e.clientY, e);
  });
  window.addEventListener("mouseup", onEnd);
}

async function castVote(row, direction, li) {
  if (direction === "up") row.upvotes += 1;
  else row.downvotes += 1;

  // stays in the list — just refresh its displayed vote counts
  const votesEl = li.querySelector(".row-votes");
  if (votesEl) {
    votesEl.innerHTML = `<span class="up">↑${row.upvotes}</span><span class="down">↓${row.downvotes}</span>`;
  }

  toast(direction === "up" ? "Upvoted" : "Downvoted");

  const col = direction === "up" ? "F" : "G";
  const value = direction === "up" ? row.upvotes : row.downvotes;
  try {
    await updateCell(`${col}${row.rowNumber}`, value);
  } catch (err) {
    console.error(err);
    toast("Vote saved locally, but the sheet update failed.", true);
  }
}

// ============================================================
// DETAIL SCREEN
// ============================================================
let currentDetailRow = null;

async function openDetail(row) {
  currentDetailRow = row;
  showScreen("detail");

  $("detail-reference").textContent = row.reference || "(untitled passage)";

  const summaryWrap = $("detail-summary-wrap");
  if (row.summary) {
    summaryWrap.hidden = false;
    $("detail-summary").textContent = row.summary;
  } else {
    summaryWrap.hidden = true;
  }

  const notesWrap = $("detail-notes-wrap");
  if (row.notes) {
    notesWrap.hidden = false;
    $("detail-notes-text").textContent = row.notes;
  } else {
    notesWrap.hidden = true;
  }

  $("detail-text").textContent = "Loading…";
  loadPassageText(row.reference);
}

async function loadPassageText(reference) {
  const el = $("detail-text");
  if (!reference) {
    el.textContent = "No reference given for this entry.";
    return;
  }
  try {
    const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${encodeURIComponent(
      CFG.BIBLE_TRANSLATION
    )}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("lookup failed");
    const data = await res.json();
    if (!data.text) throw new Error("empty passage");
    el.textContent = data.text.trim();
  } catch (err) {
    console.error(err);
    el.textContent = `Couldn't load the passage text automatically for "${reference}." (Check the reference matches how the API expects it, e.g. "John 3:16-18".)`;
  }
}

function closeDetail() {
  currentDetailRow = null;
  showScreen("list");
}

async function markDone() {
  if (!currentDetailRow) return;
  const row = currentDetailRow;
  const date = todayISO();
  row.dateDiscussed = date;
  try {
    await updateCell(`C${row.rowNumber}`, date);
    toast("Marked as discussed");
  } catch (err) {
    console.error(err);
    toast("Couldn't update the sheet — try again.", true);
    row.dateDiscussed = ""; // revert
    return;
  }
  renderList();
  closeDetail();
}

async function deleteEntry() {
  if (!currentDetailRow) return;
  const row = currentDetailRow;
  const ok = window.confirm("Remove this from the pending list? It'll stay in the sheet marked \"Skipped.\"");
  if (!ok) return;
  row.dateDiscussed = "Skipped";
  try {
    await updateCell(`C${row.rowNumber}`, "Skipped");
    toast("Removed from the list");
  } catch (err) {
    console.error(err);
    toast("Couldn't update the sheet — try again.", true);
    row.dateDiscussed = ""; // revert
    return;
  }
  renderList();
  closeDetail();
}

async function refreshList() {
  const btn = $("btn-refresh");
  btn.classList.add("spinning");
  try {
    await loadSheet(true);
    toast("Refreshed");
  } finally {
    btn.classList.remove("spinning");
  }
}

// ============================================================
// ADD SCREEN
// ============================================================
const ADDED_BY_STORAGE_KEY = "ledger_added_by";

function openAddScreen() {
  $("add-reference").value = "";
  $("add-summary").value = "";
  $("add-notes").value = "";
  // Prefer the Google account's name; fall back to a locally remembered
  // override (e.g. if someone prefers a nickname) if we have neither.
  const override = localStorage.getItem(ADDED_BY_STORAGE_KEY);
  $("add-added-by").value = googleDisplayName || override || "";
  $("add-error").hidden = true;
  showScreen("add");
  $("add-reference").focus();
}

function closeAddScreen() {
  showScreen("list");
}

async function onAddSubmit(e) {
  e.preventDefault();
  const reference = $("add-reference").value.trim();
  const addedBy = $("add-added-by").value.trim();
  const summary = $("add-summary").value.trim();
  const notes = $("add-notes").value.trim();
  const errEl = $("add-error");
  errEl.hidden = true;

  if (!reference) {
    errEl.hidden = false;
    errEl.textContent = "Please enter a scripture reference.";
    return;
  }

  const btn = $("btn-add-save");
  btn.disabled = true;
  btn.textContent = "Adding…";

  try {
    // Reference, Added By, Date Discussed (blank = pending), Summary,
    // Notes, Upvotes, Downvotes, Category (blank = not a Sunday-reading row)
    await appendRow([reference, addedBy, "", summary, notes, 0, 0, ""]);
    localStorage.setItem(ADDED_BY_STORAGE_KEY, addedBy);
    closeAddScreen();
    toast("Added to the list");
    await loadSheet(true);
  } catch (err) {
    console.error(err);
    errEl.hidden = false;
    errEl.textContent = "Couldn't save — check your connection and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Add to the list";
  }
}

// ============================================================
// WIRE UP
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  $("btn-signin").addEventListener("click", signIn);
  $("btn-pick-file").addEventListener("click", openPicker);
  $("btn-signout").addEventListener("click", signOut);
  $("btn-refresh").addEventListener("click", refreshList);
  $("btn-back").addEventListener("click", closeDetail);
  $("btn-done").addEventListener("click", markDone);
  $("btn-delete").addEventListener("click", deleteEntry);
  $("btn-add").addEventListener("click", openAddScreen);
  $("btn-add-cancel").addEventListener("click", closeAddScreen);
  $("add-form").addEventListener("submit", onAddSubmit);

  // google script loads async; poll briefly until it's ready
  const waitForGoogle = setInterval(() => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      clearInterval(waitForGoogle);
      initAuth();
    }
  }, 50);
});
