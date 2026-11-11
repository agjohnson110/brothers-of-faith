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
const USERNAME_STORAGE_KEY = "ledger_username";
const SECRET_STORAGE_KEY = "ledger_secret";
let currentUsername = "";
let currentSecret = "";
let rows = []; // { rowNumber, reference, addedBy, dateDiscussed, summary, notes, upvotes, downvotes }

const $ = (id) => document.getElementById(id);

const screens = {
  signin: $("screen-signin"),
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
function setSigninError(message) {
  const error = $("signin-error");
  error.textContent = message;
  error.hidden = false;
}

function clearCredentials() {
  currentUsername = "";
  currentSecret = "";
  localStorage.removeItem(USERNAME_STORAGE_KEY);
  localStorage.removeItem(SECRET_STORAGE_KEY);
}

async function initializeAuth() {
  const username = localStorage.getItem(USERNAME_STORAGE_KEY);
  const secret = localStorage.getItem(SECRET_STORAGE_KEY);
  if (!username || !secret) return;

  try {
    await postApi("validate", {}, username, secret);
    currentUsername = username;
    currentSecret = secret;
    await enterApp();
  } catch (err) {
    if (err.message === "Unauthorized") {
      clearCredentials();
      setSigninError("The username or shared secret is incorrect. Please sign in again.");
    } else {
      console.error(err);
      setSigninError(
        err.message === "The Apps Script API URL is not configured." ||
          err.message.includes("API_SECRET")
          ? err.message
          : "Couldn't verify your sign-in. Check your connection and try again."
      );
    }
  }
}

async function signIn(event) {
  event.preventDefault();
  const username = $("signin-username").value.trim();
  const secret = $("signin-secret").value;
  const button = $("btn-signin");
  $("signin-error").hidden = true;

  if (!username || !secret) {
    setSigninError("Enter both your username and the shared secret.");
    return;
  }

  button.disabled = true;
  button.textContent = "Signing in...";
  try {
    await postApi("validate", {}, username, secret);
    currentUsername = username;
    currentSecret = secret;
    localStorage.setItem(USERNAME_STORAGE_KEY, username);
    localStorage.setItem(SECRET_STORAGE_KEY, secret);
    $("signin-secret").value = "";
    await enterApp();
  } catch (err) {
    if (err.message === "Unauthorized") {
      setSigninError("The username or shared secret is incorrect.");
    } else {
      console.error(err);
      setSigninError(
        err.message === "The Apps Script API URL is not configured." ||
          err.message.includes("API_SECRET")
          ? err.message
          : "Couldn't sign in. Check your connection and try again."
      );
    }
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

function signOut() {
  closeMenu();
  clearCredentials();
  $("signin-secret").value = "";
  showScreen("signin");
}

async function enterApp() {
  showScreen("list");
  await loadSheet();
}

// ============================================================
// APPS SCRIPT API
// ============================================================
async function postApi(action, fields = {}, username = currentUsername, secret = currentSecret) {
  if (!CFG.API_URL) throw new Error("The Apps Script API URL is not configured.");

  const res = await fetch(CFG.API_URL, {
    method: "POST",
    body: JSON.stringify({ action, ...fields, username, secret }),
  });
  if (!res.ok) throw new Error(`Apps Script API error ${res.status}`);

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("The Apps Script API returned an invalid response.");
  }
  if (!data || data.success !== true) {
    if (data && data.error === "Unauthorized") throw new Error("Unauthorized");
    throw new Error((data && data.error) || "The Apps Script request failed.");
  }
  return data;
}

function handleUnauthorized() {
  clearCredentials();
  $("signin-secret").value = "";
  showScreen("signin");
  setSigninError("Your sign-in is no longer valid. Please enter your credentials again.");
}

async function apiRequest(action, fields = {}) {
  try {
    return await postApi(action, fields);
  } catch (err) {
    if (err.message === "Unauthorized") handleUnauthorized();
    throw err;
  }
}

async function loadSheet(quiet = false) {
  const status = $("list-status");
  const listEl = $("list");
  if (!quiet) {
    status.hidden = false;
    status.textContent = "Loading passages...";
    listEl.hidden = true;
  }
  try {
    const data = await apiRequest("getRows");
    const values = data.values || [];
    rows = values.map((r, i) => ({
      rowNumber: i + 2,
      reference: (r[0] || "").trim(),
      addedBy: (r[1] || "").trim(),
      dateDiscussed: (r[2] || "").trim(),
      summary: (r[3] || "").trim(),
      notes: (r[4] || "").trim(),
      upvotes: parseInt(r[5], 10) || 0,
      downvotes: parseInt(r[6], 10) || 0,
      category: (r[7] || "").trim(),
    }));
    // Re-sort only after loading; local votes do not reshuffle the list.
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

async function updateCell(cell, value) {
  await apiRequest("updateCell", { cell, value });
}

async function resetAllVotes() {
  closeMenu();
  if (!rows.length) {
    toast("There are no rows to reset");
    return;
  }
  if (!window.confirm("Reset all upvotes and downvotes for every row in the sheet?")) return;

  try {
    await apiRequest("resetVotes");
    rows.forEach((row) => {
      row.upvotes = 0;
      row.downvotes = 0;
    });
    renderList();
    toast("All votes reset");
  } catch (err) {
    console.error(err);
    toast("Couldn't reset votes - try again.", true);
  }
}

async function appendRow(values) {
  await apiRequest("appendRow", { values });
}

async function updateRowFields(rowNumber, reference, addedBy, dateDiscussed, summary, notes) {
  await apiRequest("updateRow", {
    rowNumber,
    values: [reference, addedBy, dateDiscussed, summary, notes],
  });
}

function closeMenu() {
  ["main-menu", "detail-menu"].forEach((menuId) => {
    const menu = $(menuId);
    if (menu) menu.hidden = true;
  });
  ["btn-menu", "btn-detail-menu"].forEach((buttonId) => {
    const button = $(buttonId);
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

function toggleMenu(menuId = "main-menu", buttonId = "btn-menu") {
  const menu = $(menuId);
  const button = $(buttonId);
  if (!menu.hidden) {
    closeMenu();
    return;
  }
  closeMenu();
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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
      ${row.category ? '<div class="row-badge"></div>' : ""}
      <div class="row-reference"></div>
      <div class="row-summary"></div>
      <div class="row-meta"></div>
    </div>
  `;

  if (row.category) li.querySelector(".row-badge").textContent = row.category;
  li.querySelector(".row-reference").textContent = row.reference || "(untitled passage)";
  li.querySelector(".row-summary").textContent = row.summary || "No summary yet.";
  li.querySelector(".row-meta").textContent = isSunday
    ? row.addedBy // role label, e.g. "First Reading"
    : !row.category && row.addedBy
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
  closeMenu();
  currentDetailRow = row;
  showScreen("detail");
  $("menu-hide").hidden = Boolean(row.category);

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
    const apiReference = reference.replace(/(\d+)[a-z](?=\s*(?:[,;:-]|$))/gi, "$1");
    const url = `https://bible-api.com/${encodeURIComponent(apiReference)}?translation=${encodeURIComponent(
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
  closeMenu();
  if (!currentDetailRow) return;
  const row = currentDetailRow;
  const date = todayISO();

  if (row.category) {
    try {
      await appendRow([
        row.reference,
        row.addedBy,
        date,
        row.summary,
        row.notes,
        row.upvotes,
        row.downvotes,
        "",
      ]);
      toast("Copied and marked discussed");
      await loadSheet(true);
      closeDetail();
    } catch (err) {
      console.error(err);
      toast("Couldn't copy the row — try again.", true);
    }
    return;
  }

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
  closeMenu();
  if (!currentDetailRow) return;
  const row = currentDetailRow;
  if (row.category) return;

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
// ADD / EDIT SCREEN
// ============================================================
let addFormMode = "add"; // "add" | "edit"
let editingRow = null; // the row object being edited, when in edit mode

function openAddScreen() {
  addFormMode = "add";
  editingRow = null;
  $("btn-random-reference").hidden = false;
  $("add-screen-title").textContent = "Add Passage";
  $("btn-add-save").textContent = "Add to the list";
  $("add-reference").value = "";
  $("add-summary").value = "";
  $("add-notes").value = "";
  $("add-added-by").value = currentUsername;
  $("add-error").hidden = true;
  showScreen("add");
  $("add-reference").focus();
}

function openEditScreen(row) {
  if (!row) return;
  addFormMode = "edit";
  editingRow = row;
  $("btn-random-reference").hidden = true;
  $("add-screen-title").textContent = "Edit Passage";
  $("btn-add-save").textContent = "Save changes";
  $("add-reference").value = row.reference || "";
  $("add-added-by").value = row.addedBy || "";
  $("add-summary").value = row.summary || "";
  $("add-notes").value = row.notes || "";
  $("add-error").hidden = true;
  showScreen("add");
  $("add-reference").focus();
}

async function fillRandomLectionaryReference() {
  const button = $("btn-random-reference");
  const error = $("add-error");
  error.hidden = true;
  button.disabled = true;
  button.classList.add("spinning");

  try {
    const data = await apiRequest("getRandomLectionaryReference");
    if (
      typeof data.reference !== "string" ||
      !data.reference.trim() ||
      typeof data.summary !== "string"
    ) {
      throw new Error("The Lectionary API returned invalid passage data.");
    }
    $("add-reference").value = data.reference.trim();
    $("add-summary").value = data.summary.trim();
    $("add-notes").value = "Random Access Revelation";
    $("add-reference").focus();
  } catch (err) {
    console.error(err);
    if (err.message !== "Unauthorized") {
      error.hidden = false;
      error.textContent = "Couldn't load a random Lectionary passage. Try again.";
    }
  } finally {
    button.disabled = false;
    button.classList.remove("spinning");
  }
}

function closeAddScreen() {
  // Return to wherever it makes sense to land: back to the passage's own
  // detail screen if we were editing it, otherwise back to the list.
  if (addFormMode === "edit" && editingRow) {
    showScreen("detail");
  } else {
    showScreen("list");
  }
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

  const isEdit = addFormMode === "edit" && editingRow;
  const btn = $("btn-add-save");
  btn.disabled = true;
  btn.textContent = isEdit ? "Saving…" : "Adding…";

  try {
    if (isEdit) {
      // Only touches Reference/Added By/Summary/Notes — Date Discussed,
      // votes, and Category are left exactly as they were.
      await updateRowFields(
        editingRow.rowNumber,
        reference,
        addedBy,
        editingRow.dateDiscussed,
        summary,
        notes
      );
      editingRow.reference = reference;
      editingRow.addedBy = addedBy;
      editingRow.summary = summary;
      editingRow.notes = notes;
      toast("Changes saved");
      renderList(); // reflect the edit without reshuffling sort order
      openDetail(editingRow); // refresh the detail screen (re-fetches passage text if the reference changed)
    } else {
      // Reference, Added By, Date Discussed (blank = pending), Summary,
      // Notes, Upvotes, Downvotes, Category (blank = not a Sunday-reading row)
      await appendRow([reference, addedBy, "", summary, notes, 0, 0, ""]);
      closeAddScreen();
      toast("Added to the list");
      await loadSheet(true);
    }
  } catch (err) {
    console.error(err);
    errEl.hidden = false;
    errEl.textContent = "Couldn't save — check your connection and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "Save changes" : "Add to the list";
  }
}

// ============================================================
// WIRE UP
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  $("signin-form").addEventListener("submit", signIn);
  $("btn-menu").addEventListener("click", () => toggleMenu());
  $("btn-detail-menu").addEventListener("click", () =>
    toggleMenu("detail-menu", "btn-detail-menu")
  );
  $("menu-signout").addEventListener("click", signOut);
  $("menu-reset-votes").addEventListener("click", resetAllVotes);
  $("menu-help").addEventListener("click", () => {
    closeMenu();
    $("help-dialog").showModal();
  });
  $("btn-help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (event) => {
    if (event.target === $("help-dialog")) $("help-dialog").close();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  $("btn-refresh").addEventListener("click", refreshList);
  $("btn-back").addEventListener("click", closeDetail);
  $("menu-done").addEventListener("click", markDone);
  $("menu-hide").addEventListener("click", deleteEntry);
  $("btn-add").addEventListener("click", openAddScreen);
  $("btn-edit").addEventListener("click", () => openEditScreen(currentDetailRow));
  $("btn-add-cancel").addEventListener("click", closeAddScreen);
  $("btn-random-reference").addEventListener("click", fillRandomLectionaryReference);
  $("add-form").addEventListener("submit", onAddSubmit);

  initializeAuth();
});
