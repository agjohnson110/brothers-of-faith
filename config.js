// ============================================================
// CONFIGURATION — fill these in after following README.md
// ============================================================
window.APP_CONFIG = {
  // From Google Cloud Console → APIs & Services → Credentials
  // (looks like: 123456789-abc123.apps.googleusercontent.com)
  CLIENT_ID: "415965624885-qf7qhbiua5bm8sv0uokamck7nc353ajo.apps.googleusercontent.com",

  // The long ID in your sheet's URL:
  // https://docs.google.com/spreadsheets/d/THIS_PART/edit
  // original simple test
  //SPREADSHEET_ID: "1lezkjn1pwPIMkJVkRp_3gHbQbLJdJpA52aD96hkrmnQ",
  // copy of real sheet in bof folder
  //SPREADSHEET_ID: "1VitjwA75IAMNi6_2_D9ZPfhUa7qlL5FzGNTgdV2uG4M",
  //copy of real sheet in my drive
  SPREADSHEET_ID: "1RZUNP5_N5iJesoe_B9OWpulYul8z940NXs1-IgnIQXM",

  // API key for Google Picker (separate from the OAuth Client ID above).
  // From Google Cloud Console → APIs & Services → Credentials → Create
  // Credentials → API key. Restrict it to the Google Picker API and to
  // your site's HTTP referrer. See README for details.
  PICKER_API_KEY: "AIzaSyC_F6SGWuMYYsZ6z-RzeVzBEsBDq_WOstE",

  // The name of the tab inside the spreadsheet that holds the table
  SHEET_NAME: "Sheet1",

  // Bible translation code used when fetching passage text for the
  // detail screen, via bible-api.com (public domain translations only,
  // e.g. "kjv", "web", "bbe"). See README for details / how to disable.
  BIBLE_TRANSLATION: "web"
};
