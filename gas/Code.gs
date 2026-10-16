// Google Apps Script — I-DOJO integration template
// Deploy: Extensions → Apps Script → Deploy → Web app
//   Execute as: Me
//   Who has access: Anyone
// จากนั้น copy URL ของ Web app มาใช้ในฝั่ง frontend (เช่น VITE_GAS_URL)

const SHEET_ID = 'REPLACE_WITH_YOUR_GOOGLE_SHEET_ID';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result = { error: 'unknown action' };

    if (data.action === 'log_event') {
      result = logEvent(data.payload);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function logEvent(payload) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Log');
  if (!sheet) return { ok: false, message: 'ไม่พบ Sheet "Log"' };
  sheet.appendRow([new Date(), JSON.stringify(payload || {})]);
  return { ok: true };
}
