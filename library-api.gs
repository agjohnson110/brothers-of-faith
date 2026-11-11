const LIBRARY_SHEET_NAME = "Library";
const LECTIONARY_SHEET_NAME = "Lectionary";
const LIBRARY_SECRET_PROPERTY = "API_SECRET";
const LECTIONARY_REFERENCE_COLUMNS = [4, 6, 7, 9, 11, 12, 14, 16, 17];
const LECTIONARY_FIRST_DATA_ROW = 2;
const LECTIONARY_LAST_DATA_ROW = 57;

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties()
      .getProperty(LIBRARY_SECRET_PROPERTY);

    if (!secret) throw new Error("The API_SECRET script property is not configured.");
    if (request.secret !== secret) {
      return jsonResponse({ success: false, error: "Unauthorized" });
    }

    if (request.action === "validate") {
      return jsonResponse({ success: true });
    }
    if (request.action === "getRandomLectionaryReference") {
      return jsonResponse({
        success: true,
        reference: getRandomLectionaryReference(),
      });
    }

    const sheet = getLibrarySheet();
    switch (request.action) {
      case "getRows": {
        const lastRow = sheet.getLastRow();
        const values = lastRow < 2
          ? []
          : sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
        return jsonResponse({ success: true, values });
      }
      case "updateCell": {
        const cell = String(request.cell || "");
        if (!/^(C|F|G)([2-9]|[1-9]\d+)$/.test(cell)) {
          throw new Error("Invalid cell.");
        }
        sheet.getRange(cell).setValue(request.value);
        return jsonResponse({ success: true });
      }
      case "updateRow": {
        const rowNumber = Number(request.rowNumber);
        if (!Number.isInteger(rowNumber) || rowNumber < 2 ||
            !Array.isArray(request.values) || request.values.length !== 5) {
          throw new Error("Invalid row update.");
        }
        sheet.getRange(rowNumber, 1, 1, 5).setValues([request.values]);
        return jsonResponse({ success: true });
      }
      case "appendRow": {
        if (!Array.isArray(request.values) || request.values.length !== 8) {
          throw new Error("Invalid row.");
        }
        sheet.appendRow(request.values);
        return jsonResponse({ success: true });
      }
      case "resetVotes": {
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          const values = Array.from({ length: lastRow - 1 }, () => [0, 0]);
          sheet.getRange(2, 6, values.length, 2).setValues(values);
        }
        return jsonResponse({ success: true });
      }
      default:
        return jsonResponse({ success: false, error: "Unknown action." });
    }
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || String(error) });
  }
}

function doGet() {
  return jsonResponse({ success: false, error: "POST required." });
}

function getLibrarySheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(LIBRARY_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${LIBRARY_SHEET_NAME}" was not found.`);
  return sheet;
}

function getRandomLectionaryReference() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(LECTIONARY_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${LECTIONARY_SHEET_NAME}" was not found.`);

  const references = LECTIONARY_REFERENCE_COLUMNS.flatMap((column) =>
    sheet
      .getRange(
        LECTIONARY_FIRST_DATA_ROW,
        column,
        LECTIONARY_LAST_DATA_ROW - LECTIONARY_FIRST_DATA_ROW + 1,
        1
      )
      .getDisplayValues()
      .map(([value]) => value.trim())
      .filter(Boolean)
  );
  if (!references.length) {
    throw new Error("No Lectionary references were found.");
  }

  return references[Math.floor(Math.random() * references.length)];
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
