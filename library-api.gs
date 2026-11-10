const LIBRARY_SHEET_NAME = "Library";
const LIBRARY_SECRET_PROPERTY = "API_SECRET";

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

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
