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
const SHEET_RANGE_READ = `${CFG.SHEET_NAME}!A2:G`;
const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SPREADSHEET_ID}`;

let accessToken = null;
let tokenClient = null;
let rows = []; // { rowNumber, reference, addedBy, dateDiscussed, summary, notes, upvotes, downvotes }

const $ = (id) => document.getElementById(id);

const screens = {
  signin: $("screen-signin"),
  list: $("screen-list"),
  detail: $("screen-detail"),
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
function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.CLIENT_ID,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: (resp) => {
      if (resp.error) {
        $("signin-error").hidden = false;
        $("signin-error").textContent = "Sign-in failed. Please try again.";
        return;
      }
      accessToken = resp.access_token;
      sessionStorage.setItem("ledger_token", accessToken);
      enterApp();
    },
  });

  // Reuse a token from earlier this session, if we have one.
  const saved = sessionStorage.getItem("ledger_token");
  if (saved) {
    accessToken = saved;
    enterApp(true);
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
  sessionStorage.removeItem("ledger_token");
  showScreen("signin");
}

async function enterApp(isRestoredSession = false) {
  showScreen("list");
  await loadSheet(isRestoredSession);
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
      addedBy: (r[1] || "").trim(),
      dateDiscussed: (r[2] || "").trim(),
      summary: (r[3] || "").trim(),
      notes: (r[4] || "").trim(),
      upvotes: parseInt(r[5], 10) || 0,
      downvotes: parseInt(r[6], 10) || 0,
    }));
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

  li.innerHTML = `
    <div class="row-flag row-flag-left">＋</div>
    <div class="row-flag row-flag-right">－</div>
    <div class="row-card">
      <div class="row-votes"><span class="up">↑${row.upvotes}</span><span class="down">↓${row.downvotes}</span></div>
      <div class="row-reference"></div>
      <div class="row-summary"></div>
      <div class="row-meta"></div>
    </div>
  `;

  li.querySelector(".row-reference").textContent = row.reference || "(untitled passage)";
  li.querySelector(".row-summary").textContent = row.summary || "No summary yet.";
  li.querySelector(".row-meta").textContent = row.addedBy ? `added by ${row.addedBy}` : "";

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
  let startX = 0,
    startY = 0,
    dx = 0,
    dy = 0,
    dragging = false,
    decided = false,
    isHorizontal = false;

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
      card.style.transform = `translateX(${dx > 0 ? "120%" : "-120%"})`;
      castVote(row, direction, li);
    } else {
      card.style.transform = "translateX(0)";
    }
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

  // remove the row from view after the fling animation
  setTimeout(() => {
    li.remove();
    if (pendingRows().length === 0) renderList();
  }, 180);

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

  $("detail-eyebrow").textContent = row.addedBy ? `Added by ${row.addedBy}` : "The Ledger";
  $("detail-reference").textContent = row.reference || "(untitled passage)";
  $("detail-meta").textContent = "Pending discussion";
  $("detail-votes").innerHTML = `<span class="up">↑ ${row.upvotes} up</span><span class="down">↓ ${row.downvotes} down</span>`;

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

// ============================================================
// WIRE UP
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  $("btn-signin").addEventListener("click", signIn);
  $("btn-signout").addEventListener("click", signOut);
  $("btn-back").addEventListener("click", closeDetail);
  $("btn-done").addEventListener("click", markDone);
  $("btn-delete").addEventListener("click", deleteEntry);

  // google script loads async; poll briefly until it's ready
  const waitForGoogle = setInterval(() => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      clearInterval(waitForGoogle);
      initAuth();
    }
  }, 50);
});
