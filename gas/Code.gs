/**
 * Google Apps Script Backend for Allonsy Time Tracker (BYO Bound Spreadsheet)
 *
 * USER-SELECTED SPREADSHEET ARCHITECTURE:
 * - Each RPC receives the spreadsheet URL saved in this user's app settings.
 * - The script opens only that selected spreadsheet; no ID is stored project-wide.
 * - PASSIVE schema inspection: NO ensureSchema mutation calls, no legacy header appending,
 *   no creating extra tabs, no wiping sheets, and no index-0 fallback.
 */

var GAS_TEMPLATE_VERSION = '2.4.0-points-rewards';
var GAS_TEMPLATE_BUILD_ID = '2026-11-19-points-rewards-01';


function gasJsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function gasRpcMethods_() {
  return {
    gasHealthCheck: gasHealthCheck,
    gasSetupSpreadsheet: gasSetupSpreadsheet,
    gasLoadAllData: gasLoadAllData,
    gasSaveTimeEntry: gasSaveTimeEntry,
    gasDeleteTimeEntry: gasDeleteTimeEntry,
    gasSyncAll: gasSyncAll,
    gasSaveConfig: gasSaveConfig,
    gasListEmployees: gasListEmployees,
    gasSaveEmployee: gasSaveEmployee,
    gasArchiveEmployee: gasArchiveEmployee,
    gasListRatings: gasListRatings,
    gasSaveRating: gasSaveRating,
    gasGetImageLibrary: gasGetImageLibrary,
    gasSaveImageRegistry: gasSaveImageRegistry,
    gasSaveImageAssignments: gasSaveImageAssignments,
    gasSetupAddImageUrlColumn: gasSetupAddImageUrlColumn,
    gasExecutePointsCommand: gasExecutePointsCommand
  };
}

function gasHandleRpc_(payload) {
  var method = payload && typeof payload.method === 'string' ? payload.method : '';
  var methods = gasRpcMethods_();
  if (!Object.prototype.hasOwnProperty.call(methods, method)) {
    return { ok: false, success: false, code: 'GAS_METHOD_BLOCKED', error: 'Цей метод Apps Script не дозволений.' };
  }
  var args = payload && Array.isArray(payload.args) ? payload.args : [];
  var spreadsheetInput = payload && typeof payload.spreadsheetInput === 'string' ? payload.spreadsheetInput : '';
  try {
    return methods[method].apply(null, [spreadsheetInput].concat(args));
  } catch (error) {
    return { ok: false, success: false, code: 'GAS_RPC_ERROR', error: String(error && error.message || error) };
  }
}

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var payload = {
    method: params.method || 'gasHealthCheck',
    spreadsheetInput: params.spreadsheetInput || '',
    args: []
  };
  try {
    if (params.args) payload.args = JSON.parse(params.args);
    if (!Array.isArray(payload.args)) throw new Error('args must be an array');
    return gasJsonOutput_(gasHandleRpc_(payload));
  } catch (error) {
    return gasJsonOutput_({ ok: false, success: false, code: 'GAS_REQUEST_INVALID', error: 'Некоректний запит до Apps Script.' });
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.args || [])) {
      throw new Error('invalid payload');
    }
    return gasJsonOutput_(gasHandleRpc_(payload));
  } catch (error) {
    return gasJsonOutput_({ ok: false, success: false, code: 'GAS_REQUEST_INVALID', error: 'Некоректне тіло запиту до Apps Script.' });
  }
}

function extractSpreadsheetIdFromInput_(rawInput) {
  var raw = String(rawInput || '').trim();
  if (!raw) return '';
  var match = raw.match(/[/]spreadsheets[/]d[/]([a-zA-Z0-9_-]{10,120})/);
  var spreadsheetId = match ? match[1] : raw;
  return /^[a-zA-Z0-9_-]{10,120}$/.test(spreadsheetId) ? spreadsheetId : '';
}

function getPinnedSpreadsheetId_() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
      return String(PropertiesService.getScriptProperties().getProperty('BOUND_SPREADSHEET_ID') || '').trim();
    }
  } catch (err) {}
  return '';
}

/**
 * Private owner-run one-time initializer (trailing underscore prevents google.script.run / RPC exposure).
 * Run once from the bound copy's Apps Script editor to pin Script Properties to this spreadsheet.
 */
function initializeBoundSpreadsheet_() {
  var active = SpreadsheetApp && typeof SpreadsheetApp.getActiveSpreadsheet === 'function'
    ? SpreadsheetApp.getActiveSpreadsheet()
    : null;
  if (!active) {
    return {
      ok: false,
      code: 'NO_ACTIVE_SPREADSHEET',
      error: 'Запустіть initializeBoundSpreadsheet_() із редактора Apps Script, відкритого з вашої копії Google Таблиці.'
    };
  }
  var activeId = active.getId();
  var activeName = active.getName();
  var props = PropertiesService.getScriptProperties();
  var existingId = String(props.getProperty('BOUND_SPREADSHEET_ID') || '').trim();
  if (existingId && existingId !== activeId) {
    return {
      ok: false,
      code: 'SPREADSHEET_BINDING_MISMATCH',
      boundSpreadsheetId: existingId,
      activeSpreadsheetId: activeId,
      error: 'Скрипт уже прив’язаний до іншої таблиці (' + existingId + '). Автоматичне перенаправлення заблоковано.'
    };
  }
  props.setProperty('BOUND_SPREADSHEET_ID', activeId);
  props.setProperty('BOUND_SPREADSHEET_NAME', activeName);
  return {
    ok: true,
    alreadyInitialized: Boolean(existingId === activeId),
    spreadsheetId: activeId,
    spreadsheetName: activeName
  };
}

/**
 * Resolves the spreadsheet cleanly:
 * - If Script Properties has a pinned BOUND_SPREADSHEET_ID, opens ONLY that ID and rejects mismatching inputs.
 * - Otherwise uses the spreadsheet URL/ID selected in this user's app settings (fail-closed if invalid/missing).
 */
function getBoundSpreadsheet(spreadsheetInput) {
  var pinnedId = getPinnedSpreadsheetId_();
  var requestedId = extractSpreadsheetIdFromInput_(spreadsheetInput);

  if (pinnedId) {
    if (requestedId && requestedId !== pinnedId) {
      return {
        ok: false,
        code: 'SPREADSHEET_MISMATCH',
        error: 'Посилання в налаштуваннях не збігається з таблицею, прив’язаною до цього Apps Script.'
      };
    }
    try {
      var pinnedSs = SpreadsheetApp.openById(pinnedId);
      return { ok: true, spreadsheet: pinnedSs, spreadsheetId: pinnedSs.getId(), spreadsheetName: pinnedSs.getName() };
    } catch (err) {
      return { ok: false, code: 'SPREADSHEET_UNAVAILABLE', error: 'Не вдалося відкрити прив’язану Google Таблицю.' };
    }
  }

  var spreadsheetId = requestedId;
  if (!spreadsheetId) {
    return { ok: false, code: 'SPREADSHEET_URL_REQUIRED', error: 'Додайте посилання на власну Google Таблицю в Налаштуваннях → Google Таблиця.' };
  }
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    return { ok: true, spreadsheet: ss, spreadsheetId: ss.getId(), spreadsheetName: ss.getName() };
  } catch (err) {
    return { ok: false, code: 'SPREADSHEET_UNAVAILABLE', error: 'Не вдалося відкрити цю Google Таблицю. Перевірте посилання та доступ до неї з вашого Apps Script.' };
  }
}

/**
 * Safely executes a mutation under LockService.getScriptLock() (with fallback to getUserLock)
 * on the bound spreadsheet. Uses tryLock() rather than waitLock() because waitLock() returns void.
 */
function withUserWriteLock(fn, spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return {
      ok: false,
      success: false,
      code: opened.code,
      error: opened.error
    };
  }

  var lock = null;
  if (typeof LockService !== 'undefined' && LockService) {
    if (typeof LockService.getScriptLock === 'function') {
      lock = LockService.getScriptLock();
    } else if (typeof LockService.getUserLock === 'function') {
      lock = LockService.getUserLock();
    }
  }

  if (!lock) {
    return {
      ok: false,
      success: false,
      code: 'LOCK_UNAVAILABLE',
      error: 'Сервіс блокування Google Apps Script недоступний.'
    };
  }

  var acquired = false;
  try {
    if (typeof lock.tryLock === 'function') {
      acquired = Boolean(lock.tryLock(15000));
      if (!acquired) {
        try {
          if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.sleep === 'function') {
            Utilities.sleep(350);
          }
        } catch (sleepErr) {}
        acquired = Boolean(lock.tryLock(5000));
      }
    } else if (typeof lock.waitLock === 'function') {
      var waitRes = lock.waitLock(15000);
      acquired = waitRes !== false;
    }
  } catch (lockErr) {
    acquired = false;
  }

  if (!acquired) {
    return {
      ok: false,
      success: false,
      code: 'LOCK_CONTENTION',
      error: 'Конфлікт блокування: інший запис ще триває. Зачекайте кілька секунд і спробуйте знову.'
    };
  }

  try {
    var result = fn(opened.spreadsheet, opened.spreadsheetId);
    try {
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp && typeof SpreadsheetApp.flush === 'function') {
        SpreadsheetApp.flush();
      }
    } catch (flushErr) {}
    return result;
  } catch (err) {
    return {
      ok: false,
      success: false,
      code: 'GAS_WRITE_ERROR',
      error: err.toString()
    };
  } finally {
    try {
      if (typeof lock.hasLock !== 'function' || lock.hasLock()) {
        lock.releaseLock();
      }
    } catch (releaseErr) {}
  }
}

/* ============================================================================
 * Canonical Header Validation & Idempotent Row Helpers (NO ensureSchema)
 * ========================================================================== */

/**
 * Reusable header-map helper:
 * - Exact header matching (case-insensitive & trimmed)
 * - Detects duplicate headers
 * - Enforces required canonical headers
 * - No positional fallback
 * - Returns colMap: { canonicalHeaderLower: 0-based column index }
 */
function normalizeHeaderLabelServer(raw) {
  if (raw === undefined || raw === null) return '';
  return raw
    .toString()
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getValidatedHeaderMap(sheet, requiredHeaders, optionalHeaders) {
  if (!sheet) {
    return {
      ok: false,
      code: 'SHEET_NOT_FOUND',
      error: 'Аркуш не знайдено в таблиці.'
    };
  }

  var lastCol = sheet.getLastColumn();
  if (lastCol <= 0) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «' + sheet.getName() + '» порожній і не містить заголовків. Операцію заблоковано.'
    };
  }

  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colMap = {};
  var duplicateHeaders = [];
  var seen = {};

  for (var i = 0; i < rawHeaders.length; i++) {
    var h = normalizeHeaderLabelServer(rawHeaders[i]);
    if (!h) continue;
    var lower = h.toLowerCase();
    if (seen.hasOwnProperty(lower)) {
      duplicateHeaders.push(h);
    } else {
      seen[lower] = i;
      colMap[lower] = i;
    }
  }

  if (duplicateHeaders.length > 0) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «' + sheet.getName() + '» містить дублікати заголовків: ' + duplicateHeaders.join(', ') + '. Операцію заблоковано.'
    };
  }

  var missing = [];
  if (requiredHeaders && requiredHeaders.length > 0) {
    for (var r = 0; r < requiredHeaders.length; r++) {
      var reqKey = normalizeHeaderLabelServer(requiredHeaders[r]).toLowerCase();
      if (!colMap.hasOwnProperty(reqKey)) {
        missing.push(requiredHeaders[r]);
      }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «' + sheet.getName() + '» не містить обов\'язкових канонічних заголовків: ' + missing.join(', ') + '. Операцію заблоковано.'
    };
  }

  return {
    ok: true,
    colMap: colMap,
    headers: rawHeaders.map(function(h) { return normalizeHeaderLabelServer(h); }),
    lastCol: lastCol
  };
}

/**
 * Protects text cells against formula injection.
 */
function protectTextCells(range, values) {
  if (!range || typeof range.setNumberFormat !== 'function') return;
  for (var i = 0; i < values.length; i++) {
    if (typeof values[i] === 'string') {
      var trimmed = values[i].trim();
      if (trimmed && (/^[=+@-]/.test(trimmed))) {
        try {
          range.setNumberFormat('@');
        } catch (e) {}
        return;
      }
    }
  }
}

/**
 * Idempotently upserts rows into a sheet based on exact header mapping:
 * - Updates ONLY mapped columns on existing rows, leaving ALL unknown/unmapped columns untouched.
 * - Appends new rows populating only mapped columns.
 * - Never clears the sheet or rewrites unmapped cells.
 */
function upsertCanonicalRows(sheet, idColCanonical, items, mapItemToRowObj, requiredHeaders) {
  if (!sheet || !items || !Array.isArray(items) || items.length === 0) {
    return { ok: true, count: 0 };
  }

  var headerRes = getValidatedHeaderMap(sheet, requiredHeaders || [idColCanonical]);
  if (!headerRes.ok) {
    return headerRes;
  }

  var colMap = headerRes.colMap;
  var headers = headerRes.headers;
  var idColIdx = colMap[idColCanonical.toLowerCase()];
  if (idColIdx === undefined) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Стовпець ідентифікатора «' + idColCanonical + '» не знайдено на аркуші «' + sheet.getName() + '».'
    };
  }

  var data = sheet.getDataRange().getValues();
  var existingRowIndexById = {};
  for (var r = 1; r < data.length; r++) {
    var cellVal = data[r][idColIdx];
    var rowId = cellVal !== undefined && cellVal !== null ? cellVal.toString().trim() : '';
    if (rowId) {
      existingRowIndexById[rowId] = r + 1; // 1-indexed row number
    }
  }

  var updatedCount = 0;
  var insertedCount = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var rowObj = mapItemToRowObj(item);
    var itemId = rowObj[idColCanonical] ? rowObj[idColCanonical].toString().trim() : '';
    if (!itemId) continue;

    if (existingRowIndexById[itemId]) {
      // Narrow update: modify only the mapped cells, preserve all existing cells
      var rowNum = existingRowIndexById[itemId];
      var existingRowValues = data[rowNum - 1];
      var newRowValues = existingRowValues.slice(0, headers.length);

      for (var colKey in rowObj) {
        if (rowObj.hasOwnProperty(colKey)) {
          var mappedIdx = colMap[colKey.toLowerCase()];
          if (mappedIdx !== undefined) {
            newRowValues[mappedIdx] = rowObj[colKey];
          }
        }
      }

      var updateRange = sheet.getRange(rowNum, 1, 1, headers.length);
      protectTextCells(updateRange, newRowValues);
      updateRange.setValues([newRowValues]);
      data[rowNum - 1] = newRowValues;
      updatedCount++;
    } else {
      // Append new row: size exactly matches current sheet headers, populate only mapped cells
      var appendRowValues = new Array(headers.length);
      for (var c = 0; c < headers.length; c++) {
        appendRowValues[c] = '';
      }

      for (var colKey2 in rowObj) {
        if (rowObj.hasOwnProperty(colKey2)) {
          var mappedIdx2 = colMap[colKey2.toLowerCase()];
          if (mappedIdx2 !== undefined) {
            appendRowValues[mappedIdx2] = rowObj[colKey2];
          }
        }
      }

      var targetRow = sheet.getLastRow() + 1;
      sheet.appendRow(appendRowValues);
      try {
        var newRange = sheet.getRange(targetRow, 1, 1, headers.length);
        protectTextCells(newRange, appendRowValues);
      } catch (e) {}
      existingRowIndexById[itemId] = sheet.getLastRow();
      data.push(appendRowValues);
      insertedCount++;
    }
  }

  return {
    ok: true,
    updatedCount: updatedCount,
    insertedCount: insertedCount,
    totalCount: updatedCount + insertedCount
  };
}

/**
 * Reads canonical rows from a sheet as an array of objects.
 */
function readCanonicalSheetObjects(sheet, requiredHeaders) {
  if (!sheet) return { ok: true, objects: [] };
  var headerRes = getValidatedHeaderMap(sheet, requiredHeaders);
  if (!headerRes.ok) {
    return headerRes;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { ok: true, objects: [] };
  }

  var headers = headerRes.headers;
  var result = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var hasContent = false;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var val = row[c];
      if (val !== undefined && val !== null && val !== '') {
        hasContent = true;
      }
      obj[headers[c].toLowerCase()] = val;
    }
    if (hasContent) {
      result.push(obj);
    }
  }

  return { ok: true, objects: result };
}

function formatSheetCell(val, kind) {
  if (val === undefined || val === null) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    var tz = Session.getScriptTimeZone() || 'Europe/Kyiv';
    if (kind === 'date') {
      return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    }
    if (kind === 'time') {
      return Utilities.formatDate(val, tz, 'HH:mm');
    }
    return val.toISOString();
  }
  return val.toString();
}

function localKyivDateTimeToUtcIso(dateValue, timeValue) {
  var dateText = String(dateValue || '').trim();
  var timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(timeValue || '').trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !timeMatch) return '';
  var hh = timeMatch[1].length === 1 ? '0' + timeMatch[1] : timeMatch[1];
  var mm = timeMatch[2];
  try {
    return Utilities.parseDate(dateText + ' ' + hh + ':' + mm, 'Europe/Kyiv', 'yyyy-MM-dd HH:mm').toISOString();
  } catch (err) {
    return '';
  }
}

function cleanImageRef(val) {
  if (!val) return '';
  var s = val.toString().trim();
  if (s.indexOf('data:image') === 0) {
    return '[локальне зображення]';
  }
  return s;
}

function extractDriveFileIdServer(rawInput) {
  if (!rawInput) return '';
  var s = rawInput.toString().trim();
  if (!s || s === '[локальне зображення]') return '';
  if (/^[a-zA-Z0-9_-]{15,80}$/.test(s)) {
    return s;
  }
  var fileMatch = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (fileMatch && fileMatch[1]) return fileMatch[1];
  var thumbOrOpenMatch = /drive\.google\.com\/(?:open|uc|thumbnail)\?[^#\s]*\bid=([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (thumbOrOpenMatch && thumbOrOpenMatch[1]) return thumbOrOpenMatch[1];
  var userContentMatch = /googleusercontent\.com\/(?:d\/|[^?#]*\bid=)([a-zA-Z0-9_-]{10,})/i.exec(s);
  if (userContentMatch && userContentMatch[1]) return userContentMatch[1];
  return '';
}

function normalizeCloudinaryUrlServer(rawInput) {
  var s = cleanImageRef(rawInput);
  if (!s || s === '[локальне зображення]') return '';
  if (/^\/\/res\.cloudinary\.com\//i.test(s)) {
    return 'https:' + s;
  }
  if (/^http:\/\/res\.cloudinary\.com\//i.test(s)) {
    return s.replace(/^http:\/\//i, 'https://');
  }
  if (/^res\.cloudinary\.com\//i.test(s)) {
    return 'https://' + s;
  }
  return s;
}

function isRemoteHttpUrlServer(url) {
  if (!url || typeof url !== 'string') return false;
  return /^https?:\/\/[^\s\/?#]+\.[^\s]+$/i.test(url.trim()) || /^https?:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url.trim());
}

function toUsableImageUrlServer(urlOrRef, driveFileId) {
  var idFromExplicit = extractDriveFileIdServer(driveFileId);
  var raw = normalizeCloudinaryUrlServer(urlOrRef);
  var cleanedRaw = cleanImageRef(urlOrRef);
  if (cleanedRaw === '[локальне зображення]') return '[локальне зображення]';
  if (raw) {
    var idFromUrl = extractDriveFileIdServer(raw);
    if (idFromUrl && /^https?:\/\/(drive\.google\.com|docs\.google\.com|lh\d\.googleusercontent\.com)\//i.test(raw)) {
      return 'https://drive.google.com/thumbnail?id=' + idFromUrl + '&sz=w1000';
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    if (idFromUrl) {
      return 'https://drive.google.com/thumbnail?id=' + idFromUrl + '&sz=w1000';
    }
  }
  if (idFromExplicit) {
    return 'https://drive.google.com/thumbnail?id=' + idFromExplicit + '&sz=w1000';
  }
  return cleanedRaw;
}

function resolveAssetUrlDetailsServer(explicitUrl, fileRef, driveFileId) {
  var candidates = [
    { source: 'image_url', val: cleanImageRef(explicitUrl) },
    { source: 'file_reference', val: cleanImageRef(fileRef) }
  ];

  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i].val;
    if (!cand || cand === '[локальне зображення]') continue;
    if (/^\/assets\/aistudio\/image_/i.test(cand)) continue;
    var converted = toUsableImageUrlServer(cand, '');
    if (isRemoteHttpUrlServer(converted)) {
      return {
        url: converted,
        valid: true,
        sourceField: candidates[i].source,
        rawRef: cand
      };
    }
  }

  var driveUrl = toUsableImageUrlServer('', driveFileId);
  if (isRemoteHttpUrlServer(driveUrl)) {
    return {
      url: driveUrl,
      valid: true,
      sourceField: 'drive_file_id',
      rawRef: cleanImageRef(driveFileId)
    };
  }

  var nonEmptyRaw = cleanImageRef(explicitUrl) || cleanImageRef(fileRef) || cleanImageRef(driveFileId);
  if (!nonEmptyRaw || nonEmptyRaw === '[локальне зображення]') {
    return {
      url: nonEmptyRaw === '[локальне зображення]' ? '[локальне зображення]' : '',
      valid: false,
      reason: 'missing_url',
      rawRef: nonEmptyRaw
    };
  }

  return {
    url: nonEmptyRaw,
    valid: false,
    reason: 'invalid_url',
    rawRef: nonEmptyRaw
  };
}

function parseCanonicalBool(val, defaultVal) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  var s = val.toString().replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').trim().toLowerCase();
  if (!s) return defaultVal;
  if (s === 'true' || s === '1' || s === 'так' || s === 'істина' || s === 'yes' || s === 'y' || s === '+') return true;
  if (s === 'false' || s === '0' || s === 'ні' || s === 'хиба' || s === 'no' || s === 'n' || s === '-') return false;
  return defaultVal;
}

function pickObjField(obj, aliases) {
  if (!obj) return '';
  for (var i = 0; i < aliases.length; i++) {
    var key = aliases[i].toLowerCase();
    if (obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return '';
}

function folderToGroupServer(folderPath) {
  var f = (folderPath || '').toString().trim();
  if (f === 'images/character/alternate') return 'character_alternate';
  if (f === 'images/team/avatars') return 'team_avatars';
  if (f === 'images/team/portraits') return 'team_portraits';
  if (f === 'images/bonuses') return 'bonuses';
  return 'character_primary';
}

function getValidatedHeaderMapWithAliases(sheet, requiredAliasGroups) {
  var baseRes = getValidatedHeaderMap(sheet, []);
  if (!baseRes.ok) return baseRes;

  var missing = [];
  if (requiredAliasGroups && requiredAliasGroups.length > 0) {
    for (var g = 0; g < requiredAliasGroups.length; g++) {
      var group = requiredAliasGroups[g];
      var found = false;
      for (var a = 0; a < group.length; a++) {
        if (baseRes.colMap.hasOwnProperty(group[a].toLowerCase())) {
          found = true;
          break;
        }
      }
      if (!found) {
        missing.push(group.join(' / '));
      }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «' + sheet.getName() + '» не містить обов\'язкових канонічних заголовків: ' + missing.join(', ') + '. Операцію заблоковано.'
    };
  }

  return baseRes;
}

function readCanonicalSheetObjectsWithAliases(sheet, requiredAliasGroups) {
  if (!sheet) {
    return {
      ok: false,
      code: 'SHEET_NOT_FOUND',
      error: 'Аркуш не знайдено в таблиці.'
    };
  }
  var headerRes = getValidatedHeaderMapWithAliases(sheet, requiredAliasGroups);
  if (!headerRes.ok) return headerRes;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { ok: true, objects: [], colMap: headerRes.colMap, headers: headerRes.headers };
  }

  var headers = headerRes.headers;
  var result = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var hasContent = false;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var val = row[c];
      if (val !== undefined && val !== null && val !== '') {
        hasContent = true;
      }
      obj[headers[c].toLowerCase()] = val;
    }
    if (hasContent) {
      result.push(obj);
    }
  }

  return { ok: true, objects: result, colMap: headerRes.colMap, headers: headers };
}

function isInheritanceModeSharedServer(modeLower) {
  return (
    modeLower === 'inherit' ||
    modeLower === 'shared' ||
    modeLower === 'inherit_primary' ||
    modeLower === 'from_primary' ||
    modeLower === 'same_as_primary'
  );
}

function readImageLibraryInternal(ss) {
  var libSheet = ss.getSheetByName('Бібліотека зображень');
  if (!libSheet) {
    return {
      ok: false,
      success: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «Бібліотека зображень» не знайдено в таблиці. Завантаження заблоковано.',
      registry: [],
      assignments: []
    };
  }

  var libRes = readCanonicalSheetObjectsWithAliases(libSheet, [['asset_id', 'id', 'код']]);
  if (!libRes.ok) {
    return {
      ok: false,
      success: false,
      code: libRes.code,
      error: libRes.error,
      registry: [],
      assignments: []
    };
  }

  var registry = [];
  var assetUrlById = {};
  var assetRecordById = {};
  var seenIds = {};
  var invalidUrlAssets = [];
  var activeAssetCount = 0;
  var usableUrlCount = 0;

  for (var r = 0; r < libRes.objects.length; r++) {
    var rowObj = libRes.objects[r];
    var assetId = formatSheetCell(pickObjField(rowObj, ['asset_id', 'id', 'код']), 'text').trim();
    if (!assetId) continue;

    var filename = formatSheetCell(pickObjField(rowObj, ['filename', 'file_name', 'файл']), 'text').trim();
    var displayName = formatSheetCell(pickObjField(rowObj, ['display_name', 'name', 'назва']), 'text').trim();
    var folderPath = formatSheetCell(pickObjField(rowObj, ['folder_path', 'folder', 'папка']), 'text').trim() || 'images/character/primary';
    var storageStatus = formatSheetCell(pickObjField(rowObj, ['storage_status', 'status', 'статус_зберігання']), 'text').trim() || 'external_url';
    var driveFileId = formatSheetCell(pickObjField(rowObj, ['drive_file_id', 'drive_id']), 'text').trim();
    var fileRef = formatSheetCell(pickObjField(rowObj, ['file_reference', 'file_ref', 'cloudinary_url', 'ref']), 'text').trim();
    var explicitUrl = formatSheetCell(pickObjField(rowObj, ['image_url', 'imageurl', 'url']), 'text').trim();
    var isActiveRaw = pickObjField(rowObj, ['is_active', 'active', 'активна', 'активний']);
    var isActive = parseCanonicalBool(isActiveRaw, true);
    var updatedAt = formatSheetCell(pickObjField(rowObj, ['updated_at_utc', 'updated_at', 'оновлено_utc']), 'text').trim();

    var urlInfo = resolveAssetUrlDetailsServer(explicitUrl, fileRef, driveFileId);
    var finalUrl = urlInfo.url;
    var isRemote = urlInfo.valid;

    if (isActive) {
      activeAssetCount++;
      if (isRemote) {
        usableUrlCount++;
      } else {
        invalidUrlAssets.push({
          assetId: assetId,
          name: displayName || filename || assetId,
          rawRef: urlInfo.rawRef || '',
          reason: urlInfo.reason || 'invalid_url',
          message: urlInfo.reason === 'missing_url'
            ? 'Актив «' + (displayName || assetId) + '» не має Cloudinary/HTTPS URL у file_reference або image_url.'
            : 'Актив «' + (displayName || assetId) + '» містить некоректне посилання: «' + (urlInfo.rawRef || '') + '».'
        });
      }
    }

    var assetItem = {
      id: assetId,
      name: displayName || filename || assetId,
      group: folderToGroupServer(folderPath),
      folder: folderPath,
      url: finalUrl,
      imageUrl: isRemote ? finalUrl : '',
      source: isRemote ? 'external_url' : 'builtin',
      storageType: isRemote ? 'external_url' : (storageStatus || 'bundled'),
      storageStatus: storageStatus,
      isActive: isActive,
      persistenceStatus: 'saved_to_sheets',
      statusMessage: !isRemote && isActive
        ? (urlInfo.reason === 'missing_url' ? 'Відсутній URL Cloudinary / HTTPS' : 'Некоректний формат URL')
        : '',
      createdAt: updatedAt,
      updatedAt: updatedAt
    };

    registry.push(assetItem);
    seenIds[assetId] = true;
    assetRecordById[assetId] = { item: assetItem, valid: isRemote, reason: urlInfo.reason || '', rawRef: urlInfo.rawRef || '' };
    if (isActive && isRemote && finalUrl) {
      assetUrlById[assetId] = finalUrl;
    }
  }

  // Optional fallback variants sheet «Зображення» (used only if present, validated passively)
  var variantsSheet = ss.getSheetByName('Зображення');
  if (variantsSheet) {
    var varRes = readCanonicalSheetObjectsWithAliases(variantsSheet, [['variant_id', 'id']]);
    if (!varRes.ok) {
      return {
        ok: false,
        success: false,
        code: varRes.code,
        error: varRes.error,
        registry: [],
        assignments: []
      };
    }
    if (varRes.objects) {
      for (var vi = 0; vi < varRes.objects.length; vi++) {
        var vObj = varRes.objects[vi];
        var vId = formatSheetCell(pickObjField(vObj, ['variant_id', 'id']), 'text').trim();
        if (!vId) continue;
        var vActive = parseCanonicalBool(pickObjField(vObj, ['активний', 'активна', 'is_active', 'active']), true);
        if (!vActive) continue;
        var vUrlInfo = resolveAssetUrlDetailsServer(
          formatSheetCell(pickObjField(vObj, ['image_url', 'url']), 'text').trim(),
          formatSheetCell(pickObjField(vObj, ['file_reference', 'cloudinary_url']), 'text').trim(),
          formatSheetCell(pickObjField(vObj, ['drive_file_id']), 'text').trim()
        );
        if (vUrlInfo.valid && !assetUrlById[vId]) {
          assetUrlById[vId] = vUrlInfo.url;
        }
        if (!seenIds[vId] && vUrlInfo.valid) {
          seenIds[vId] = true;
          var vItem = {
            id: vId,
            name: formatSheetCell(pickObjField(vObj, ['назва', 'display_name', 'name']), 'text').trim() || vId,
            group: 'character_primary',
            folder: 'images/character/primary',
            url: vUrlInfo.url,
            imageUrl: vUrlInfo.url,
            source: 'external_url',
            storageType: 'external_url',
            isActive: true,
            persistenceStatus: 'saved_to_sheets',
            createdAt: formatSheetCell(pickObjField(vObj, ['оновлено_utc', 'updated_at_utc']), 'text').trim(),
            updatedAt: formatSheetCell(pickObjField(vObj, ['оновлено_utc', 'updated_at_utc']), 'text').trim()
          };
          registry.push(vItem);
          assetRecordById[vId] = { item: vItem, valid: true, reason: '', rawRef: vUrlInfo.url };
        }
      }
    }
  }

  var assignSheet = ss.getSheetByName('Призначення зображень');
  if (!assignSheet) {
    return {
      ok: false,
      success: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Аркуш «Призначення зображень» не знайдено в таблиці. Завантаження заблоковано.',
      registry: [],
      assignments: []
    };
  }

  var assignRes = readCanonicalSheetObjectsWithAliases(assignSheet, [['slot_key', 'slot'], ['asset_id', 'asset']]);
  if (!assignRes.ok) {
    return {
      ok: false,
      success: false,
      code: assignRes.code,
      error: assignRes.error,
      registry: [],
      assignments: []
    };
  }

  var assignments = [];
  var assignmentUrlBySlot = {};
  var unresolvedAssignments = [];

  for (var ar = 0; ar < assignRes.objects.length; ar++) {
    var aRowObj = assignRes.objects[ar];
    var slotKey = formatSheetCell(pickObjField(aRowObj, ['slot_key', 'slot']), 'text').trim();
    var assignAssetId = formatSheetCell(pickObjField(aRowObj, ['asset_id', 'asset']), 'text').trim();
    var targetType = formatSheetCell(pickObjField(aRowObj, ['target_type', 'targettype']), 'text').trim();
    var targetId = formatSheetCell(pickObjField(aRowObj, ['target_id', 'targetid']), 'text').trim();
    if (!slotKey && !assignAssetId) continue;

    var assignActiveRaw = pickObjField(aRowObj, ['active', 'is_active', 'активна', 'активний']);
    var assignActive = parseCanonicalBool(assignActiveRaw, true);
    var inheritanceMode = formatSheetCell(pickObjField(aRowObj, ['inheritance_mode', 'inherit_mode', 'mode']), 'text').trim();
    var assignId = formatSheetCell(pickObjField(aRowObj, ['assignment_id', 'id']), 'text').trim() || ('assign-' + (ar + 1));
    var updatedUtc = formatSheetCell(pickObjField(aRowObj, ['updated_at_utc', 'updated_at']), 'text').trim();

    var assignItem = {
      id: assignId,
      targetType: targetType,
      targetId: targetId,
      slotKey: slotKey,
      assetId: assignAssetId,
      inheritanceMode: inheritanceMode,
      active: assignActive,
      assignedAt: updatedUtc || new Date().toISOString()
    };
    assignments.push(assignItem);

    var parsedStage = resolveStageSlotServer(assignItem);
    var inheritLower = inheritanceMode.toLowerCase();
    var isInherited = isInheritanceModeSharedServer(inheritLower) ||
      (parsedStage && parsedStage.kind === 'alternate' && /^asset-char-primary-stage-0?[1-5]$/.test(assignAssetId) &&
       Number(assignAssetId.replace(/^.*stage-0?/, '')) === parsedStage.stage);

    if (assignActive && slotKey && assignAssetId) {
      var directInfo = resolveAssetUrlDetailsServer(assignAssetId, '', '');
      var mappedUrl = assetUrlById[assignAssetId] || (directInfo.valid ? directInfo.url : '');
      if (mappedUrl) {
        assignmentUrlBySlot[slotKey] = mappedUrl;
        if (parsedStage) {
          assignmentUrlBySlot['images/character/' + parsedStage.kind + '/' + parsedStage.stage] = mappedUrl;
        } else if (targetType.toLowerCase() === 'bonus' && targetId) {
          assignmentUrlBySlot['images/bonuses/' + targetId] = mappedUrl;
        } else if ((targetType.toLowerCase() === 'employee' || targetType.toLowerCase() === 'team') && targetId) {
          if (slotKey.toLowerCase().indexOf('portrait') !== -1) {
            assignmentUrlBySlot['images/team/portraits/' + targetId] = mappedUrl;
          } else {
            assignmentUrlBySlot['images/team/avatars/' + targetId] = mappedUrl;
          }
        }
      } else if (parsedStage && !isInherited) {
        var rec = assetRecordById[assignAssetId];
        var stageNum = parsedStage.stage;
        if (!rec) {
          unresolvedAssignments.push({
            assetId: assignAssetId,
            slotKey: slotKey,
            stage: stageNum,
            reason: 'missing_asset',
            message: 'Призначення для етапу ' + stageNum + ' посилається на відсутній asset_id «' + assignAssetId + '».'
          });
        } else if (rec.item.isActive === false) {
          unresolvedAssignments.push({
            assetId: assignAssetId,
            name: rec.item.name,
            slotKey: slotKey,
            stage: stageNum,
            reason: 'inactive_asset',
            message: 'Актив «' + rec.item.name + '» (' + assignAssetId + ') для етапу ' + stageNum + ' вимкнено (is_active = FALSE).'
          });
        } else {
          unresolvedAssignments.push({
            assetId: assignAssetId,
            name: rec.item.name,
            slotKey: slotKey,
            stage: stageNum,
            rawRef: rec.rawRef || '',
            reason: rec.reason || 'invalid_url',
            message: rec.reason === 'missing_url'
              ? 'Актив «' + rec.item.name + '» (' + assignAssetId + ') для етапу ' + stageNum + ' не містить URL Cloudinary / HTTPS у file_reference або image_url.'
              : 'Актив «' + rec.item.name + '» (' + assignAssetId + ') для етапу ' + stageNum + ' має некоректний URL: «' + (rec.rawRef || '') + '».'
          });
        }
      }
    }
  }

  return {
    ok: true,
    success: true,
    registry: registry,
    assignments: assignments,
    assetUrlById: assetUrlById,
    assignmentUrlBySlot: assignmentUrlBySlot,
    imageDiagnostics: {
      totalAssets: registry.length,
      activeAssets: activeAssetCount,
      usableUrlCount: usableUrlCount,
      invalidUrlAssets: invalidUrlAssets,
      unresolvedAssignments: unresolvedAssignments
    }
  };
}

function resolveStageSlotServer(assign) {
  if (!assign) return null;
  var slotLower = (assign.slotKey || '').toString().trim().toLowerCase();
  var targetTypeLower = (assign.targetType || '').toString().trim().toLowerCase();
  var targetIdLower = (assign.targetId || '').toString().trim().toLowerCase();

  if (!slotLower) return null;
  if (slotLower.indexOf('team') !== -1 || slotLower.indexOf('bonus') !== -1 || slotLower.indexOf('employee') !== -1) {
    return null;
  }
  if (targetTypeLower && !/^(character|stage|character_stage|етап)$/.test(targetTypeLower)) {
    return null;
  }

  var kind = '';
  if (/(?:^|[\/_.-])alternate(?:$|[\/_.-])/.test(slotLower) || /(?:^|[\/_.-])alternate(?:$|[\/_.-])/.test(targetIdLower)) {
    kind = 'alternate';
  } else if (/(?:^|[\/_.-])primary(?:$|[\/_.-])/.test(slotLower) || /(?:^|[\/_.-])primary(?:$|[\/_.-])/.test(targetIdLower)) {
    kind = 'primary';
  } else if (/(?:^|[\/_.-])stage[-_]?0?[1-5](?:$|[\/_.-])/.test(slotLower)) {
    kind = 'primary';
  }
  if (!kind) return null;

  var stageNum = 0;
  var slotStageMatch = /(?:stage[-_]?|(?:^|\/)(?:primary|alternate)\/(?:stage[-_]?)?)0?([1-5])(?:$|[\/_.-])/.exec(slotLower);
  if (slotStageMatch) {
    stageNum = Number(slotStageMatch[1]);
  } else if (targetIdLower) {
    var targetStageMatch = /^(?:stage[-_]?)?0?([1-5])$/.exec(targetIdLower);
    if (targetStageMatch) {
      stageNum = Number(targetStageMatch[1]);
    }
  }

  if (stageNum < 1 || stageNum > 5) return null;
  return { kind: kind, stage: stageNum };
}

function buildStagesFromLibraryServer(settingsMap, libData) {
  var defaultThresholds = [0, 20, 40, 60, 80];
  var stages = [];
  for (var idx = 0; idx < 5; idx++) {
    var stageNum = idx + 1;
    stages.push({
      stage: stageNum,
      name: 'Етап ' + stageNum,
      thresholdPercent: defaultThresholds[idx],
      primaryImage: '',
      alternateImage: ''
    });
  }

  if (!libData || !libData.ok) return stages;

  var assetUrlById = libData.assetUrlById || {};
  var inheritedAlternates = {};
  var assignments = libData.assignments || [];

  for (var i = 0; i < assignments.length; i++) {
    var assign = assignments[i];
    if (assign.active === false || !assign.slotKey) continue;
    var parsed = resolveStageSlotServer(assign);
    if (!parsed) continue;

    var stageObj = stages[parsed.stage - 1];
    var aid = (assign.assetId || '').toString().trim();
    var directDetails = resolveAssetUrlDetailsServer(aid, '', '');
    var resolved = assetUrlById[aid] || (directDetails.valid ? directDetails.url : '');
    var inheritModeLower = (assign.inheritanceMode || '').toString().trim().toLowerCase();

    if (parsed.kind === 'primary' && resolved) {
      stageObj.primaryImage = resolved;
    } else if (parsed.kind === 'alternate') {
      if (
        isInheritanceModeSharedServer(inheritModeLower) ||
        (/^asset-char-primary-stage-0?[1-5]$/.test(aid) && Number(aid.replace(/^.*stage-0?/, '')) === parsed.stage)
      ) {
        inheritedAlternates[parsed.stage] = true;
      } else if (resolved) {
        stageObj.alternateImage = resolved;
      }
    }
  }

  for (var s = 0; s < stages.length; s++) {
    var st = stages[s];
    if (st.primaryImage && (!st.alternateImage || inheritedAlternates[st.stage])) {
      st.alternateImage = st.primaryImage;
    }
  }

  return stages;
}

function resolveRefUrlServer(rawRef, slotKey, libData) {
  var ref = cleanImageRef(rawRef);
  if (ref === '[локальне зображення]') return '[локальне зображення]';
  if (libData && libData.ok) {
    if (ref && libData.assetUrlById && libData.assetUrlById[ref]) {
      return libData.assetUrlById[ref];
    }
    if (!ref && slotKey && libData.assignmentUrlBySlot && libData.assignmentUrlBySlot[slotKey]) {
      return libData.assignmentUrlBySlot[slotKey];
    }
  }
  if (ref) {
    return toUsableImageUrlServer(ref, '');
  }
  if (libData && libData.ok && slotKey && libData.assignmentUrlBySlot && libData.assignmentUrlBySlot[slotKey]) {
    return libData.assignmentUrlBySlot[slotKey];
  }
  return '';
}

function getRatingMetaServer(scoreVal) {
  var num = Number(scoreVal);
  if (isNaN(num) || Math.floor(num) !== num || num < 1 || num > 5) {
    return null;
  }
  var scale = {
    1: { score: 1, emoji: '😞', sentiment: 'negative', label: 'Негативно' },
    2: { score: 2, emoji: '😕', sentiment: 'negative', label: 'Негативно' },
    3: { score: 3, emoji: '😐', sentiment: 'neutral', label: 'Нейтрально' },
    4: { score: 4, emoji: '🙂', sentiment: 'positive', label: 'Позитивно' },
    5: { score: 5, emoji: '🤩', sentiment: 'positive', label: 'Позитивно' }
  };
  return scale[num] || null;
}

/* ============================================================================
 * Narrowly Scoped Server RPC Methods called via google.script.run
 * All RPC methods use the spreadsheet URL supplied with that user request and return plain JSON objects.
 * ========================================================================== */

/**
 * 1. Health check: verifies Google authorization and access to canonical spreadsheet.
 */
function gasHealthCheck(spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return {
      ok: false,
      success: false,
      code: opened.code,
      version: GAS_TEMPLATE_VERSION,
      buildId: GAS_TEMPLATE_BUILD_ID,
      error: opened.error
    };
  }

  var ss = opened.spreadsheet;
  var requiredSheets = ['Записи', 'Категорії', 'Працівники', 'Оцінки', 'Бібліотека зображень'];
  var missingSheets = [];
  for (var i = 0; i < requiredSheets.length; i++) {
    if (!ss.getSheetByName(requiredSheets[i])) {
      missingSheets.push(requiredSheets[i]);
    }
  }

  return {
    ok: true,
    success: true,
    status: 'online',
    executionMode: 'USER_SELECTED_SHEET',
    spreadsheetId: opened.spreadsheetId,
    spreadsheetName: ss.getName(),
    version: GAS_TEMPLATE_VERSION,
    buildId: GAS_TEMPLATE_BUILD_ID,
    missingCanonicalSheets: missingSheets,
    timestamp: new Date().toISOString()
  };
}

/**
 * 2. PASSIVE setup / schema audit:
 * Verifies canonical tabs and headers without mutating the spreadsheet.
 * Never calls ensureSchema, never creates extra tabs, and never appends legacy headers.
 */
function gasSetupSpreadsheet(spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return { ok: false, success: false, code: opened.code, error: opened.error };
  }

  var ss = opened.spreadsheet;
  var canonicalChecks = [
    { name: 'Записи', required: ['segment_id', 'session_id', 'дата', 'секунд', 'category_id'] },
    { name: 'Категорії', required: ['id', 'назва'] },
    { name: 'Типи дій', required: ['id', 'назва'] },
    { name: 'Проєкти', required: ['id', 'назва'] },
    { name: 'Бонуси', required: ['id', 'назва', 'ціна_балів'] },
    { name: 'Фрази', aliasGroups: [['id', 'phrase_id', 'код'], ['текст', 'фраза', 'text', 'повідомлення']] },
    { name: 'Мотиваційні фрази', aliasGroups: [['id', 'template_id', 'код'], ['template', 'шаблон', 'текст', 'фраза', 'text', 'повідомлення']] },
    { name: 'Налаштування', required: ['ключ', 'значення'] },
    { name: 'Працівники', required: ['employee_id', 'name'] },
    { name: 'Оцінки', required: ['rating_id', 'employee_id', 'score'] },
    { name: 'Бібліотека зображень', aliasGroups: [['asset_id', 'id', 'код']] },
    { name: 'Призначення зображень', aliasGroups: [['slot_key', 'slot'], ['asset_id', 'asset']] }
  ];

  var auditResults = [];
  var hasBlockers = false;

  for (var i = 0; i < canonicalChecks.length; i++) {
    var check = canonicalChecks[i];
    var sheet = ss.getSheetByName(check.name);
    if (!sheet) {
      auditResults.push({ sheet: check.name, status: 'MISSING' });
      hasBlockers = true;
      continue;
    }
    var valRes = check.aliasGroups
      ? getValidatedHeaderMapWithAliases(sheet, check.aliasGroups)
      : getValidatedHeaderMap(sheet, check.required);
    if (!valRes.ok) {
      auditResults.push({ sheet: check.name, status: 'BLOCKED', error: valRes.error });
      hasBlockers = true;
    } else {
      auditResults.push({ sheet: check.name, status: 'OK', headerCount: valRes.headers.length });
    }
  }

  if (hasBlockers) {
    return {
      ok: false,
      success: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      spreadsheetId: opened.spreadsheetId,
      spreadsheetName: ss.getName(),
      audit: auditResults,
      error: 'Виявлено невідповідність канонічній схемі таблиці. Мутації заблоковано для збереження цілісності даних.'
    };
  }

  return {
    ok: true,
    success: true,
    status: 'online',
    executionMode: 'USER_SELECTED_SHEET',
    spreadsheetId: opened.spreadsheetId,
    spreadsheetName: ss.getName(),
    audit: auditResults,
    message: 'Усі канонічні аркуші та заголовки успішно перевірено (пасивна перевірка без мутацій).',
    timestamp: new Date().toISOString()
  };
}

/**
 * 3. Read-only data loader: loads structured data from canonical tabs.
 * Converts integer секунд to durationMinutes without loss, preserving exact seconds.
 * Excludes soft-deleted entries. Deduplicates entries across Записи and month partition tabs.
 */
function gasLoadAllData(spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return { ok: false, success: false, code: opened.code, error: opened.error };
  }

  try {
    var ss = opened.spreadsheet;
    var entriesSheet = ss.getSheetByName('Записи');
    if (!entriesSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Записи» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }

    // Read entries from 'Записи'
    var entriesRes = readCanonicalSheetObjects(entriesSheet, ['segment_id']);
    if (!entriesRes.ok) {
      return { ok: false, success: false, code: entriesRes.code, error: entriesRes.error };
    }

    var entriesMap = {};
    var deletedSegmentIds = {};
    for (var ei = 0; ei < entriesRes.objects.length; ei++) {
      var row = entriesRes.objects[ei];
      var deletedAt = formatSheetCell(row['deleted_at_utc'], 'text').trim();
      var segmentId = formatSheetCell(row['segment_id'], 'text').trim();
      if (!segmentId) continue;
      if (deletedAt) { deletedSegmentIds[segmentId] = true; continue; } // Keep tombstone

      var rawSec = Number(row['секунд']);
      var sec = !isNaN(rawSec) && rawSec >= 0 ? Math.round(rawSec) : 0;
      var durationMins = Math.round(sec / 60);

      var startUtc = formatSheetCell(row['початок_utc'], 'text').trim();
      var endUtc = formatSheetCell(row['кінець_utc'], 'text').trim();
      var dateStr = formatSheetCell(row['дата'], 'date').split('T')[0];

      // Convert UTC timestamps to the user's Kyiv local time
      var startTime = startUtc ? Utilities.formatDate(new Date(startUtc), 'Europe/Kyiv', 'HH:mm') : '10:00';
      var endTime = endUtc ? Utilities.formatDate(new Date(endUtc), 'Europe/Kyiv', 'HH:mm') : '11:00';

      var source = formatSheetCell(row['джерело'], 'text').toLowerCase();
      var isManual = source === 'manual' || source.indexOf('ручн') !== -1;

      entriesMap[segmentId] = {
        id: segmentId,
        date: dateStr,
        startTime: startTime,
        endTime: endTime,
        durationMinutes: durationMins,
        elapsedSeconds: sec,
        categoryId: formatSheetCell(row['category_id'], 'text').trim(),
        categoryName: formatSheetCell(row['категорія_назва'], 'text').trim(),
        actionTypeId: formatSheetCell(row['action_id'], 'text').trim(),
        projectId: formatSheetCell(row['project_id'], 'text').trim(),
        employeeId: formatSheetCell(row['employee_id'], 'text').trim(),
        relatedEmployeeId: formatSheetCell(row['related_employee_id'], 'text').trim() || undefined,
        description: formatSheetCell(row['опис'], 'text').trim(),
        isManual: isManual,
        sessionId: formatSheetCell(row['session_id'], 'text').trim() || segmentId,
        commandId: formatSheetCell(row['command_id'], 'text').trim() || ('cmd-' + segmentId),
        startedAtUtc: startUtc,
        endedAtUtc: endUtc,
        monthKey: formatSheetCell(row['month_key'], 'text').trim() || (dateStr ? dateStr.substring(0, 7) : ''),
        createdAtUtc: formatSheetCell(row['створено_utc'], 'text').trim(),
        updatedAtUtc: formatSheetCell(row['updated_at_utc'], 'text').trim(),
        notes: formatSheetCell(row['примітка'], 'text').trim()
      };
    }

    // Read monthly partition tabs (e.g. 2026-11) without duplicating rows or swallowing errors
    var allSheets = ss.getSheets();
    for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
      var sName = allSheets[sIdx].getName();
      if (/^\d{4}-\d{2}$/.test(sName)) {
        var partRes = readCanonicalSheetObjects(allSheets[sIdx], ['segment_id']);
        if (!partRes.ok) {
          return { ok: false, success: false, code: partRes.code, error: partRes.error };
        }
        if (partRes.objects) {
          for (var pi = 0; pi < partRes.objects.length; pi++) {
            var pRow = partRes.objects[pi];
            var pDel = formatSheetCell(pRow['deleted_at_utc'], 'text').trim();
            if (pDel) continue;
            var pSegId = formatSheetCell(pRow['segment_id'], 'text').trim();
            if (!pSegId) continue;

            // Only add if not already in entriesMap from Записи
            if (!deletedSegmentIds[pSegId] && !entriesMap[pSegId]) {
              var pSec = Math.round(Number(pRow['секунд']) || 0);
              var pDateStr = formatSheetCell(pRow['дата'], 'date').split('T')[0];
              var pStartUtc = formatSheetCell(pRow['початок_utc'], 'text').trim();
              var pEndUtc = formatSheetCell(pRow['кінець_utc'], 'text').trim();
              var pSt = pStartUtc ? Utilities.formatDate(new Date(pStartUtc), 'Europe/Kyiv', 'HH:mm') : '10:00';
              var pEt = pEndUtc ? Utilities.formatDate(new Date(pEndUtc), 'Europe/Kyiv', 'HH:mm') : '11:00';

              entriesMap[pSegId] = {
                id: pSegId,
                date: pDateStr,
                startTime: pSt,
                endTime: pEt,
                durationMinutes: Math.round(pSec / 60),
                elapsedSeconds: pSec,
                categoryId: formatSheetCell(pRow['category_id'], 'text').trim(),
                categoryName: formatSheetCell(pRow['категорія_назва'], 'text').trim(),
                actionTypeId: formatSheetCell(pRow['action_id'], 'text').trim(),
                projectId: formatSheetCell(pRow['project_id'], 'text').trim(),
                employeeId: formatSheetCell(pRow['employee_id'], 'text').trim(),
                relatedEmployeeId: formatSheetCell(pRow['related_employee_id'], 'text').trim() || undefined,
                description: formatSheetCell(pRow['опис'], 'text').trim(),
                isManual: formatSheetCell(pRow['джерело'], 'text').toLowerCase() === 'manual',
                sessionId: formatSheetCell(pRow['session_id'], 'text').trim() || pSegId,
                commandId: formatSheetCell(pRow['command_id'], 'text').trim() || ('cmd-' + pSegId),
                startedAtUtc: pStartUtc,
                endedAtUtc: pEndUtc,
                monthKey: sName,
                createdAtUtc: formatSheetCell(pRow['створено_utc'], 'text').trim(),
                updatedAtUtc: formatSheetCell(pRow['updated_at_utc'], 'text').trim(),
                notes: formatSheetCell(pRow['примітка'], 'text').trim()
              };
            }
          }
        }
      }
    }

    var entries = Object.keys(entriesMap).map(function(k) { return entriesMap[k]; });

    // Read Image Library & Assignments first so bonuses, employees, and stages can resolve URLs
    var libData = readImageLibraryInternal(ss);
    if (!libData.ok) {
      return {
        ok: false,
        success: false,
        code: libData.code,
        error: libData.error
      };
    }

    // Read Categories
    var catSheet = ss.getSheetByName('Категорії');
    if (!catSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Категорії» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var catRes = readCanonicalSheetObjects(catSheet, ['id', 'назва']);
    if (!catRes.ok) {
      return { ok: false, success: false, code: catRes.code, error: catRes.error };
    }
    var categories = catRes.objects.map(function(c) {
      return {
        id: formatSheetCell(c['id'], 'text').trim(),
        name: formatSheetCell(c['назва'], 'text').trim(),
        color: formatSheetCell(c['колір_hex'], 'text').trim() || '#f97316',
        icon: formatSheetCell(c['іконка_lucide'], 'text').trim()
      };
    }).filter(function(c) { return Boolean(c.id && c.name); });

    // Read Action Types
    var actSheet = ss.getSheetByName('Типи дій');
    if (!actSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Типи дій» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var actRes = readCanonicalSheetObjects(actSheet, ['id', 'назва']);
    if (!actRes.ok) {
      return { ok: false, success: false, code: actRes.code, error: actRes.error };
    }
    var actionTypes = actRes.objects.map(function(a) {
      return {
        id: formatSheetCell(a['id'], 'text').trim(),
        name: formatSheetCell(a['назва'], 'text').trim(),
        color: '#f97316'
      };
    }).filter(function(a) { return Boolean(a.id && a.name); });

    // Read Projects
    var projSheet = ss.getSheetByName('Проєкти');
    if (!projSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Проєкти» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var projRes = readCanonicalSheetObjects(projSheet, ['id', 'назва']);
    if (!projRes.ok) {
      return { ok: false, success: false, code: projRes.code, error: projRes.error };
    }
    var projects = projRes.objects.map(function(p) {
      var isActive = parseCanonicalBool(p['активний'], true);
      return {
        id: formatSheetCell(p['id'], 'text').trim(),
        name: formatSheetCell(p['назва'], 'text').trim(),
        client: '',
        status: isActive ? 'active' : 'completed',
        color: '#f97316'
      };
    }).filter(function(p) { return Boolean(p.id && p.name); });

    // Read Bonuses & Claims
    var bonusSheet = ss.getSheetByName('Бонуси');
    if (!bonusSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Бонуси» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var bonusRes = readCanonicalSheetObjects(bonusSheet, ['id', 'назва']);
    if (!bonusRes.ok) {
      return { ok: false, success: false, code: bonusRes.code, error: bonusRes.error };
    }
    var bonuses = bonusRes.objects.map(function(b) {
      var bId = formatSheetCell(b['id'], 'text').trim();
      var bName = formatSheetCell(b['назва'], 'text').trim();
      var isActive = parseCanonicalBool(b['активний'], true);
      var rawImgRef = formatSheetCell(pickObjField(b, ['image_asset_id', 'зображення']), 'text').trim();
      var resolvedBonusUrl = bId ? resolveRefUrlServer(rawImgRef, 'images/bonuses/' + bId, libData) : '';
      return {
        id: bId,
        name: bName,
        description: formatSheetCell(b['опис'], 'text').trim(),
        rewardType: formatSheetCell(b['тип'], 'text').trim() || 'custom',
        requiredPoints: Number(b['ціна_балів']) || 0,
        isActive: isActive,
        imageUrl: resolvedBonusUrl,
        claimed: false,
        fulfilled: false
      };
    }).filter(function(b) { return Boolean(b.id && b.name); });

    // Cross-reference claims from 'Отримані бонуси' if sheet exists
    var claimsSheet = ss.getSheetByName('Отримані бонуси');
    var bonusClaims = [];
    if (claimsSheet) {
      var claimsRes = readCanonicalSheetObjects(claimsSheet, ['claim_id', 'bonus_id']);
      if (!claimsRes.ok) {
        return { ok: false, success: false, code: claimsRes.code, error: claimsRes.error };
      }
      if (claimsRes.objects) {
        var claimedBonusIds = {};
        for (var ci = 0; ci < claimsRes.objects.length; ci++) {
          var cRow = claimsRes.objects[ci];
          var claimId = formatSheetCell(cRow['claim_id'], 'text').trim();
          var bId = formatSheetCell(cRow['bonus_id'], 'text').trim();
          var cStatusRaw = formatSheetCell(cRow['статус'], 'text').toLowerCase();
          var cStatus = 'requested';
          if (cStatusRaw === 'approved' || cStatusRaw === 'погоджено') cStatus = 'approved';
          else if (cStatusRaw === 'fulfilled' || cStatusRaw === 'виконано') cStatus = 'fulfilled';
          else if (cStatusRaw === 'cancelled' || cStatusRaw === 'canceled' || cStatusRaw === 'скасовано') cStatus = 'cancelled';
          var cQty = Math.max(1, Math.round(Number(cRow['quantity']) || 1));
          var cTotal = Math.max(0, Number(cRow['вартість_балів']) || 0);
          var cUnit = cRow['unit_price_points'] !== undefined && cRow['unit_price_points'] !== ''
            ? Math.max(0, Number(cRow['unit_price_points']) || 0)
            : Math.round(cTotal / cQty);

          if (claimId && bId) {
            bonusClaims.push({
              id: claimId,
              bonusId: bId,
              bonusNameSnapshot: formatSheetCell(cRow['назва_на_момент_запиту'], 'text').trim(),
              employeeId: formatSheetCell(cRow['employee_id'], 'text').trim(),
              quantity: cQty,
              unitPricePoints: cUnit,
              totalPointsCost: cTotal,
              requestedAtUtc: formatSheetCell(cRow['дата_запиту_utc'], 'text').trim(),
              status: cStatus,
              fulfilledAtUtc: formatSheetCell(cRow['дата_отримання_utc'], 'text').trim() || undefined,
              comment: formatSheetCell(cRow['коментар'], 'text').trim() || undefined,
              commandId: formatSheetCell(cRow['command_id'], 'text').trim() || ('claim-' + claimId),
              updatedAtUtc: formatSheetCell(cRow['updated_at_utc'], 'text').trim(),
              approvedByEmployeeId: formatSheetCell(cRow['approved_by_employee_id'], 'text').trim() || undefined,
              approvedAtUtc: formatSheetCell(cRow['approved_at_utc'], 'text').trim() || undefined,
              pointsTransactionId: formatSheetCell(cRow['points_transaction_id'], 'text').trim() || undefined,
              eligibilityId: formatSheetCell(cRow['eligibility_id'], 'text').trim() || undefined
            });
          }

          if (bId && cStatus !== 'cancelled') {
            claimedBonusIds[bId] = {
              claimed: true,
              fulfilled: cStatus === 'fulfilled'
            };
          }
        }
        for (var bi = 0; bi < bonuses.length; bi++) {
          if (claimedBonusIds[bonuses[bi].id]) {
            bonuses[bi].claimed = true;
            bonuses[bi].fulfilled = claimedBonusIds[bonuses[bi].id].fulfilled;
          }
        }
      }
    }

    // Read Phrases («Фрази») supporting canonical Ukrainian & alias headers
    var phrasesSheet = ss.getSheetByName('Фрази');
    if (!phrasesSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Фрази» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var phRes = readCanonicalSheetObjectsWithAliases(phrasesSheet, [['id', 'phrase_id', 'код'], ['текст', 'фраза', 'text', 'повідомлення']]);
    if (!phRes.ok) {
      return { ok: false, success: false, code: phRes.code, error: phRes.error };
    }
    var phrases = phRes.objects.map(function(p, idx) {
      var isActive = parseCanonicalBool(pickObjField(p, ['активна', 'активний', 'active', 'is_active', 'isactive']), true);
      var rawOrder = Number(pickObjField(p, ['порядок', 'sort_order', 'order']));
      var rawId = formatSheetCell(pickObjField(p, ['id', 'phrase_id', 'код']), 'text').trim();
      var rawText = formatSheetCell(pickObjField(p, ['текст', 'фраза', 'text', 'повідомлення']), 'text').trim();
      return {
        id: rawId || (rawText ? 'ph-' + (idx + 1) : ''),
        text: rawText,
        isActive: isActive,
        order: !isNaN(rawOrder) && rawOrder > 0 ? rawOrder : idx + 1
      };
    }).filter(function(p) { return Boolean(p.id && p.text); });
    phrases.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

    // Read Motivational Phrases («Мотиваційні фрази») supporting canonical template & Ukrainian headers
    var motSheet = ss.getSheetByName('Мотиваційні фрази');
    if (!motSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Мотиваційні фрази» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var motRes = readCanonicalSheetObjectsWithAliases(motSheet, [['id', 'template_id', 'код'], ['template', 'шаблон', 'текст', 'фраза', 'text', 'повідомлення']]);
    if (!motRes.ok) {
      return { ok: false, success: false, code: motRes.code, error: motRes.error };
    }
    var motivationalPhrases = motRes.objects.map(function(m, idx) {
      var isActive = parseCanonicalBool(pickObjField(m, ['active', 'активна', 'активний', 'is_active', 'isactive']), true);
      var rawOrder = Number(pickObjField(m, ['sort_order', 'порядок', 'order']));
      var rawId = formatSheetCell(pickObjField(m, ['id', 'template_id', 'код']), 'text').trim();
      var rawTemplate = formatSheetCell(pickObjField(m, ['template', 'шаблон', 'текст', 'фраза', 'text', 'повідомлення']), 'text').trim();
      return {
        id: rawId || (rawTemplate ? 'mot-' + (idx + 1) : ''),
        template: rawTemplate,
        isActive: isActive,
        order: !isNaN(rawOrder) && rawOrder > 0 ? rawOrder : idx + 1
      };
    }).filter(function(m) { return Boolean(m.id && m.template); });
    motivationalPhrases.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

    // Read Employees (explicit schema validation)
    var empRes = readEmployeesResult(ss, libData);
    if (!empRes.ok) {
      return { ok: false, success: false, code: empRes.code, error: empRes.error };
    }
    var employees = empRes.employees;

    // Read Ratings (explicit schema validation)
    var ratRes = readRatingsResult(ss, '');
    if (!ratRes.ok) {
      return { ok: false, success: false, code: ratRes.code, error: ratRes.error };
    }
    var ratings = ratRes.ratings;

    // Read Settings (explicit schema validation)
    var settingsSheet = ss.getSheetByName('Налаштування');
    if (!settingsSheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Налаштування» не знайдено в таблиці. Завантаження заблоковано.'
      };
    }
    var setRes = readCanonicalSheetObjects(settingsSheet, ['ключ', 'значення']);
    if (!setRes.ok) {
      return { ok: false, success: false, code: setRes.code, error: setRes.error };
    }
    var settingsMap = {};
    if (setRes.objects) {
      for (var si = 0; si < setRes.objects.length; si++) {
        var k = formatSheetCell(setRes.objects[si]['ключ'], 'text').trim();
        var v = formatSheetCell(setRes.objects[si]['значення'], 'text').trim();
        if (k) settingsMap[k] = v;
      }
    }

    var eligibleCatIds = [];
    if (settingsMap['pointsEligibleCategoryIds']) {
      try {
        var parsedCats = JSON.parse(settingsMap['pointsEligibleCategoryIds']);
        if (Array.isArray(parsedCats)) {
          eligibleCatIds = parsedCats.map(function(id) { return String(id || '').trim(); }).filter(Boolean);
        }
      } catch (parseErr) {
        eligibleCatIds = settingsMap['pointsEligibleCategoryIds'].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }
    }

    var hydratedStages = buildStagesFromLibraryServer(settingsMap, libData);

    var settings = {
      hourlyRate: settingsMap['hourlyRate'] !== undefined && settingsMap['hourlyRate'] !== '' ? Number(settingsMap['hourlyRate']) : 0,
      targetHours: settingsMap['targetHours'] !== undefined && settingsMap['targetHours'] !== '' ? Number(settingsMap['targetHours']) : 0,
      progressionMode: settingsMap['progressionMode'] || 'all_time',
      bubbleDurationMs: Number(settingsMap['bubbleDurationMs']) || 5000,
      motivationRotationMinutes: Number(settingsMap['motivationRotationMinutes']) || 10,
      minutesPerPoint: Number(settingsMap['minutesPerPoint']) || 60,
      imageProgressionEnabled: settingsMap['imageProgressionEnabled'] !== 'false',
      pointsEligibleCategoryIds: eligibleCatIds,
      googleSpreadsheetId: opened.spreadsheetId,
      stages: hydratedStages
    };

    var pointsBundle = readPointsAndRewardsBundleServer_(ss);
    if (!pointsBundle.ok) {
      return { ok: false, success: false, code: pointsBundle.code, error: pointsBundle.error };
    }

    return {
      ok: true,
      success: true,
      needsSetup: false,
      spreadsheetId: opened.spreadsheetId,
      spreadsheetName: ss.getName(),
      entries: entries,
      categories: categories,
      actionTypes: actionTypes,
      projects: projects,
      bonuses: bonuses,
      bonusClaims: bonusClaims,
      phrases: phrases,
      motivationalPhrases: motivationalPhrases,
      employees: employees,
      ratings: ratings,
      imageRegistry: libData.registry,
      imageAssignments: libData.assignments,
      imageDiagnostics: libData.imageDiagnostics,
      pointsRoles: pointsBundle.pointsRoles,
      pointsProfiles: pointsBundle.pointsProfiles,
      pointsReasons: pointsBundle.pointsReasons,
      pointsTransactions: pointsBundle.pointsTransactions,
      pointsPeriods: pointsBundle.pointsPeriods,
      bonusEligibility: pointsBundle.bonusEligibility,
      pointsAudit: pointsBundle.pointsAudit,
      settings: settings
    };
  } catch (err) {
    return {
      ok: false,
      success: false,
      code: 'LOAD_ERROR',
      error: 'Помилка читання канонічної таблиці: ' + err.toString()
    };
  }
}

/**
 * 4. Save/upsert a single time entry using canonical headers and integer seconds.
 * Idempotently updates or inserts into 'Записи' (and matching month tab, e.g. '2026-11').
 * NO ensureSchema calls.
 */
function gasSaveTimeEntry(spreadsheetInput, arg1, arg2) {
  var entry = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!entry || typeof entry !== 'object' || !entry.id) {
    return { ok: false, success: false, code: 'INVALID_ENTRY', error: 'Запис часу не містить обов\'язкового ID (segment_id).' };
  }

  return withUserWriteLock(function(ss) {
    var sheet = ss.getSheetByName('Записи');
    if (!sheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Канонічний аркуш «Записи» не знайдено. Запис заблоковано.'
      };
    }

    var segmentId = String(entry.id).trim();
    var sessionId = String(entry.sessionId || segmentId).trim();
    var commandId = String(entry.commandId || ('cmd-' + segmentId)).trim();
    var dateStr = entry.date ? String(entry.date).trim() : new Date().toISOString().split('T')[0];
    var monthKey = entry.monthKey || (dateStr ? dateStr.substring(0, 7) : '2026-11');

    var sec = 0;
    if (typeof entry.elapsedSeconds === 'number' && entry.elapsedSeconds > 0) {
      sec = Math.round(entry.elapsedSeconds);
    } else {
      sec = Math.round(Math.max(0, Number(entry.durationMinutes) || 0) * 60);
    }

    var nowIso = new Date().toISOString();
    var startUtc = entry.startedAtUtc || localKyivDateTimeToUtcIso(dateStr, entry.startTime || '10:00');
    var endUtc = entry.endedAtUtc || localKyivDateTimeToUtcIso(dateStr, entry.endTime || '11:00');
    var source = entry.isManual ? 'manual' : 'timer';
    var employeeId = entry.employeeId ? String(entry.employeeId).trim() : '';

    var mappedRow = {
      'segment_id': segmentId,
      'session_id': sessionId,
      'command_id': commandId,
      'дата': dateStr,
      'початок_utc': startUtc,
      'кінець_utc': endUtc,
      'секунд': sec,
      'category_id': entry.categoryId ? String(entry.categoryId).trim() : '',
      'категорія_назва': entry.categoryName ? String(entry.categoryName).trim() : '',
      'action_id': entry.actionTypeId ? String(entry.actionTypeId).trim() : '',
      'project_id': entry.projectId ? String(entry.projectId).trim() : '',
      'опис': entry.description ? String(entry.description).trim() : '',
      'створено_utc': entry.createdAtUtc || nowIso,
      'джерело': source,
      'month_key': monthKey,
      'примітка': entry.notes ? String(entry.notes).trim() : '',
      'employee_id': employeeId,
      'related_employee_id': entry.relatedEmployeeId ? String(entry.relatedEmployeeId).trim() : '',
      'updated_at_utc': nowIso,
    };

    var upsertRes = upsertCanonicalRows(sheet, 'segment_id', [mappedRow], function(row) {
      return row;
    }, ['segment_id', 'дата', 'секунд']);

    if (!upsertRes.ok) {
      return { ok: false, success: false, code: upsertRes.code, error: upsertRes.error };
    }

    // Also sync to month partition tab (e.g. 2026-11) if present
    var monthSheet = ss.getSheetByName(monthKey);
    if (monthSheet) {
      var monthUpsertRes = upsertCanonicalRows(monthSheet, 'segment_id', [mappedRow], function(row) {
        return row;
      }, ['segment_id']);
      if (!monthUpsertRes.ok) return monthUpsertRes;
    }

    return {
      ok: true,
      success: true,
      entryId: segmentId,
      message: 'Запис часу збережено в Google Таблицю (секунд: ' + sec + ').',
      timestamp: nowIso
    };
  }, spreadsheetInput);
}

/**
 * 5. Soft-delete a time entry by setting deleted_at_utc and change_reason.
 */
function gasDeleteTimeEntry(spreadsheetInput, arg1, arg2) {
  var entryId = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!entryId || typeof entryId !== 'string') {
    return { ok: false, success: false, code: 'INVALID_ENTRY_ID', error: 'Не вказано коректний ID запису для видалення.' };
  }

  return withUserWriteLock(function(ss) {
    var sheet = ss.getSheetByName('Записи');
    if (!sheet) {
      return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Записи» не знайдено.' };
    }

    var cleanId = entryId.trim();
    var headerRes = getValidatedHeaderMap(sheet, ['segment_id', 'month_key', 'deleted_at_utc', 'change_reason']);
    if (!headerRes.ok) return headerRes;

    var idColIdx = headerRes.colMap['segment_id'];
    var monthColIdx = headerRes.colMap['month_key'];
    var delColIdx = headerRes.colMap['deleted_at_utc'];
    var reasonColIdx = headerRes.colMap['change_reason'];

    var data = sheet.getDataRange().getValues();
    var foundRow = -1;
    for (var r = 1; r < data.length; r++) {
      if (data[r][idColIdx] && data[r][idColIdx].toString().trim() === cleanId) {
        foundRow = r + 1;
        break;
      }
    }

    if (foundRow === -1) {
      return { ok: false, success: false, error: 'Запис з ID «' + cleanId + '» не знайдено в таблиці.' };
    }

    var nowIso = new Date().toISOString();
    sheet.getRange(foundRow, delColIdx + 1).setValue(nowIso);
    sheet.getRange(foundRow, reasonColIdx + 1).setValue('deleted_via_app');

    var monthKey = String(data[foundRow - 1][monthColIdx] || '').trim();
    if (monthKey) {
      var monthSheet = ss.getSheetByName(monthKey);
      if (monthSheet) {
        var monthHeaderRes = getValidatedHeaderMap(monthSheet, ['segment_id', 'deleted_at_utc', 'change_reason']);
        if (!monthHeaderRes.ok) return monthHeaderRes;
        var monthData = monthSheet.getDataRange().getValues();
        var monthIdColIdx = monthHeaderRes.colMap['segment_id'];
        var monthDelColIdx = monthHeaderRes.colMap['deleted_at_utc'];
        var monthReasonColIdx = monthHeaderRes.colMap['change_reason'];
        for (var mr = 1; mr < monthData.length; mr++) {
          if (monthData[mr][monthIdColIdx] && monthData[mr][monthIdColIdx].toString().trim() === cleanId) {
            var monthRow = mr + 1;
            monthSheet.getRange(monthRow, monthDelColIdx + 1).setValue(nowIso);
            monthSheet.getRange(monthRow, monthReasonColIdx + 1).setValue('deleted_via_app');
            break;
          }
        }
      }
    }

    return {
      ok: true,
      success: true,
      message: 'Запис успішно позначено як видалений в Google Таблиці.',
      timestamp: nowIso
    };
  }, spreadsheetInput);
}

/**
 * 6. Sync all data using narrow idempotent upserts.
 * Replaces full-sheet overwrite behavior. Validates canonical headers passively.
 * NO ensureSchema calls.
 */
function gasSyncAll(spreadsheetInput, arg1, arg2) {
  var payload = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, success: false, code: 'INVALID_PAYLOAD', error: 'Відсутні дані для синхронізації.' };
  }

  return withUserWriteLock(function(ss, spreadsheetId) {
    if (payload.entries && Array.isArray(payload.entries)) {
      var entriesSheet = ss.getSheetByName('Записи');
      if (!entriesSheet) {
        return {
          ok: false,
          success: false,
          code: 'SCHEMA_COMPATIBILITY_BLOCKED',
          error: 'Канонічний аркуш «Записи» не знайдено. Синхронізацію заблоковано.'
        };
      }

      var entryRows = payload.entries.map(function(e) {
        var segId = String(e.id).trim();
        var dateStr = e.date ? String(e.date).trim() : new Date().toISOString().split('T')[0];
        var sec = 0;
        if (typeof e.elapsedSeconds === 'number' && e.elapsedSeconds > 0) {
          sec = Math.round(e.elapsedSeconds);
        } else {
          sec = Math.round(Math.max(0, Number(e.durationMinutes) || 0) * 60);
        }
        return {
          'segment_id': segId,
          'session_id': String(e.sessionId || segId).trim(),
          'command_id': String(e.commandId || ('cmd-' + segId)).trim(),
          'дата': dateStr,
          'початок_utc': e.startedAtUtc || localKyivDateTimeToUtcIso(dateStr, e.startTime || '10:00'),
          'кінець_utc': e.endedAtUtc || localKyivDateTimeToUtcIso(dateStr, e.endTime || '11:00'),
          'секунд': sec,
          'category_id': e.categoryId ? String(e.categoryId).trim() : '',
          'категорія_назва': e.categoryName ? String(e.categoryName).trim() : '',
          'action_id': e.actionTypeId ? String(e.actionTypeId).trim() : '',
          'project_id': e.projectId ? String(e.projectId).trim() : '',
          'опис': e.description ? String(e.description).trim() : '',
          'створено_utc': e.createdAtUtc || new Date().toISOString(),
          'джерело': e.isManual ? 'manual' : 'timer',
          'month_key': e.monthKey || (dateStr ? dateStr.substring(0, 7) : '2026-11'),
          'примітка': e.notes ? String(e.notes).trim() : '',
          'employee_id': e.employeeId ? String(e.employeeId).trim() : '',
          'related_employee_id': e.relatedEmployeeId ? String(e.relatedEmployeeId).trim() : '',
          'updated_at_utc': new Date().toISOString(),
        };
      });

      var upRes = upsertCanonicalRows(entriesSheet, 'segment_id', entryRows, function(r) { return r; }, ['segment_id', 'дата', 'секунд']);
      if (!upRes.ok) return upRes;
      for (var ei = 0; ei < entryRows.length; ei++) {
        var entryRow = entryRows[ei];
        var monthKey = String(entryRow['month_key'] || '').trim();
        if (!monthKey) continue;
        var monthSheet = ss.getSheetByName(monthKey);
        if (monthSheet) {
          var monthUpsertRes = upsertCanonicalRows(monthSheet, 'segment_id', [entryRow], function(r) { return r; }, ['segment_id']);
          if (!monthUpsertRes.ok) return monthUpsertRes;
        }
      }
    }

    var configResults = [];
    if (payload.categories) configResults.push(updateCategories(ss, payload.categories));
    if (payload.actionTypes) configResults.push(updateActionTypes(ss, payload.actionTypes));
    if (payload.projects) configResults.push(updateProjects(ss, payload.projects));
    if (payload.bonuses) configResults.push(updateBonuses(ss, payload.bonuses));
    if (payload.phrases) configResults.push(updatePhrases(ss, payload.phrases));
    if (payload.motivationalPhrases) configResults.push(updateMotivationalPhrases(ss, payload.motivationalPhrases));
    if (payload.employees) configResults.push(updateEmployees(ss, payload.employees));
    if (payload.ratings) configResults.push(updateRatings(ss, payload.ratings));
    if (payload.settings) configResults.push(updateSettings(ss, payload.settings));
    for (var i = 0; i < configResults.length; i++) {
      if (!configResults[i] || configResults[i].ok === false || configResults[i].success === false) {
        return configResults[i] || { ok: false, success: false, code: 'CONFIG_WRITE_FAILED', error: 'Одна з операцій запису не підтвердила успіх.' };
      }
    }

    return {
      ok: true,
      success: true,
      spreadsheetId: spreadsheetId,
      spreadsheetName: ss.getName(),
      message: 'Усі структуровані записи успішно синхронізовано з канонічною Google Таблицею.',
      timestamp: new Date().toISOString()
    };
  }, spreadsheetInput);
}

/**
 * 7. Save config with narrow idempotent upserts.
 */
function gasSaveConfig(spreadsheetInput, arg1, arg2) {
  var configPayload = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!configPayload || typeof configPayload !== 'object') {
    return { ok: false, success: false, code: 'INVALID_CONFIG', error: 'Відсутні параметри для оновлення.' };
  }

  return withUserWriteLock(function(ss) {
    var configResults = [];
    if (configPayload.categories) configResults.push(updateCategories(ss, configPayload.categories));
    if (configPayload.actionTypes) configResults.push(updateActionTypes(ss, configPayload.actionTypes));
    if (configPayload.projects) configResults.push(updateProjects(ss, configPayload.projects));
    if (configPayload.bonuses) configResults.push(updateBonuses(ss, configPayload.bonuses));
    if (configPayload.phrases) configResults.push(updatePhrases(ss, configPayload.phrases));
    if (configPayload.motivationalPhrases) configResults.push(updateMotivationalPhrases(ss, configPayload.motivationalPhrases));
    if (configPayload.employees) configResults.push(updateEmployees(ss, configPayload.employees));
    if (configPayload.ratings) configResults.push(updateRatings(ss, configPayload.ratings));
    if (configPayload.settings) configResults.push(updateSettings(ss, configPayload.settings));
    for (var i = 0; i < configResults.length; i++) {
      if (!configResults[i] || configResults[i].ok === false || configResults[i].success === false) {
        return configResults[i] || { ok: false, success: false, code: 'CONFIG_WRITE_FAILED', error: 'Одна з операцій запису не підтвердила успіх.' };
      }
    }

    return {
      ok: true,
      success: true,
      message: 'Налаштування та довідники оновлено в Google Таблиці.',
      timestamp: new Date().toISOString()
    };
  }, spreadsheetInput);
}

/**
 * 8. Read-only list of team employees from «Працівники» tab.
 */
function gasListEmployees(spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return { ok: false, success: false, code: opened.code, error: opened.error };
  }

  try {
    var libData = readImageLibraryInternal(opened.spreadsheet);
    var empRes = readEmployeesResult(opened.spreadsheet, libData.ok ? libData : null);
    if (!empRes.ok) {
      return {
        ok: false,
        success: false,
        code: empRes.code,
        error: empRes.error
      };
    }
    return {
      ok: true,
      success: true,
      employees: empRes.employees,
      spreadsheetId: opened.spreadsheetId,
      spreadsheetName: opened.spreadsheet.getName()
    };
  } catch (err) {
    return {
      ok: false,
      success: false,
      code: 'LIST_EMPLOYEES_ERROR',
      error: 'Помилка читання списку працівників: ' + err.toString()
    };
  }
}

/**
 * 9. Save employee record to «Працівники» with canonical headers.
 */
function gasSaveEmployee(spreadsheetInput, arg1, arg2) {
  var employee = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!employee || typeof employee !== 'object') {
    return { ok: false, success: false, code: 'INVALID_EMPLOYEE', error: 'Відсутні дані співробітника.' };
  }

  return withUserWriteLock(function(ss) {
    return saveEmployeeRecord(ss, employee);
  }, spreadsheetInput);
}

/**
 * 10. Archive an existing employee non-destructively.
 */
function gasArchiveEmployee(spreadsheetInput, arg1, arg2) {
  var employeeId = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!employeeId || typeof employeeId !== 'string' || !employeeId.trim()) {
    return { ok: false, success: false, code: 'INVALID_EMPLOYEE_ID', error: 'Не вказано коректний ID співробітника.' };
  }

  return withUserWriteLock(function(ss) {
    return archiveEmployeeRecord(ss, employeeId.trim());
  }, spreadsheetInput);
}

/**
 * 11. Read-only list of ratings from «Оцінки» tab.
 */
function gasListRatings(spreadsheetInput, arg1) {
  var employeeId = typeof arg1 === 'string' ? arg1 : '';
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return { ok: false, success: false, code: opened.code, error: opened.error };
  }

  try {
    var filterId = employeeId ? employeeId.trim() : '';
    var ratRes = readRatingsResult(opened.spreadsheet, filterId);
    if (!ratRes.ok) {
      return {
        ok: false,
        success: false,
        code: ratRes.code,
        error: ratRes.error
      };
    }
    return {
      ok: true,
      success: true,
      ratings: ratRes.ratings,
      spreadsheetId: opened.spreadsheetId,
      spreadsheetName: opened.spreadsheet.getName()
    };
  } catch (err) {
    return {
      ok: false,
      success: false,
      code: 'LIST_RATINGS_ERROR',
      error: 'Помилка читання оцінок: ' + err.toString()
    };
  }
}

/**
 * 12. Save a performance rating (validated score 1..5) into «Оцінки» tab.
 */
function gasSaveRating(spreadsheetInput, arg1, arg2) {
  var rating = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!rating || typeof rating !== 'object') {
    return { ok: false, success: false, code: 'INVALID_RATING', error: 'Відсутні дані оцінки.' };
  }

  return withUserWriteLock(function(ss) {
    return saveRatingRecord(ss, rating);
  }, spreadsheetInput);
}

/**
 * 13. Read-only query for image registry and slot assignments.
 * Reads 'Бібліотека зображень' and 'Призначення зображень' with canonical headers.
 * Does NOT require image_url column — resolves Drive/HTTPS URLs cleanly without schema mutation.
 */
function gasGetImageLibrary(spreadsheetInput) {
  var opened = getBoundSpreadsheet(spreadsheetInput);
  if (!opened.ok) {
    return { ok: false, success: false, code: opened.code, error: opened.error };
  }

  try {
    var ss = opened.spreadsheet;
    var libData = readImageLibraryInternal(ss);
    if (!libData.ok) {
      return libData;
    }

    return {
      ok: true,
      success: true,
      registry: libData.registry,
      assignments: libData.assignments,
      imageDiagnostics: libData.imageDiagnostics,
      spreadsheetId: opened.spreadsheetId,
      spreadsheetName: ss.getName()
    };
  } catch (err) {
    return {
      ok: false,
      success: false,
      code: 'IMAGE_LIBRARY_READ_ERROR',
      error: 'Помилка читання бібліотеки зображень: ' + err.toString()
    };
  }
}

/**
 * 14. Save image metadata to «Бібліотека зображень».
 * Requires image_url column. If absent, returns SCHEMA_COMPATIBILITY_BLOCKED without writing.
 * NEVER overwrites drive_file_id or file_reference.
 */
function gasSaveImageRegistry(spreadsheetInput, arg1, arg2) {
  var registryPayload = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!registryPayload || !Array.isArray(registryPayload)) {
    return { ok: false, success: false, code: 'INVALID_PAYLOAD', error: 'Дані реєстру зображень мають бути масивом.' };
  }

  return withUserWriteLock(function(ss) {
    var sheet = ss.getSheetByName('Бібліотека зображень');
    if (!sheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Аркуш «Бібліотека зображень» не знайдено в канонічній таблиці. Синхронізацію заблоковано.'
      };
    }

    var headerRes = getValidatedHeaderMap(sheet, ['asset_id']);
    if (!headerRes.ok) return headerRes;

    // Check for explicit image_url column
    if (headerRes.colMap['image_url'] === undefined) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Стовпець image_url відсутній на аркуші «Бібліотека зображень». Запис заблоковано до виконання явної дії додавання стовпця.'
      };
    }

    var upsertRes = upsertCanonicalRows(sheet, 'asset_id', registryPayload, function(item) {
      var rowObj = {
        'asset_id': String(item.id || item.asset_id || '').trim(),
        'display_name': String(item.name || '').trim(),
        'folder_path': String(item.folder || item.group || '').trim(),
        'image_url': String(item.imageUrl || item.url || '').trim(),
        'updated_at_utc': new Date().toISOString()
      };
      return rowObj;
    }, ['asset_id', 'image_url']);

    if (!upsertRes.ok) return upsertRes;

    return {
      ok: true,
      success: true,
      message: 'Метадані зображень збережено в Google Таблиці.',
      timestamp: new Date().toISOString()
    };
  }, spreadsheetInput);
}

/**
 * 15. Save slot assignments to «Призначення зображень» using canonical headers.
 */
function gasSaveImageAssignments(spreadsheetInput, arg1, arg2) {
  var assignmentsPayload = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!assignmentsPayload || !Array.isArray(assignmentsPayload)) {
    return { ok: false, success: false, code: 'INVALID_PAYLOAD', error: 'Дані призначень зображень мають бути масивом.' };
  }

  return withUserWriteLock(function(ss) {
    var sheet = ss.getSheetByName('Призначення зображень');
    if (!sheet) {
      return {
        ok: false,
        success: false,
        code: 'SCHEMA_COMPATIBILITY_BLOCKED',
        error: 'Аркуш «Призначення зображень» не знайдено в канонічній таблиці. Синхронізацію заблоковано.'
      };
    }

    var headerRes = getValidatedHeaderMap(sheet, ['slot_key', 'asset_id']);
    if (!headerRes.ok) return headerRes;

    var idCol = headerRes.colMap['assignment_id'] !== undefined ? 'assignment_id' : 'slot_key';

    var upsertRes = upsertCanonicalRows(sheet, idCol, assignmentsPayload, function(assign) {
      var targetType = 'character';
      if (assign.slotKey && assign.slotKey.indexOf('team') !== -1) targetType = 'employee';
      else if (assign.slotKey && assign.slotKey.indexOf('bonuses') !== -1) targetType = 'bonus';

      var parts = (assign.slotKey || '').split('/');
      var targetId = parts[parts.length - 1] || 'character';

      var rowObj = {
        'slot_key': String(assign.slotKey || '').trim(),
        'asset_id': String(assign.assetId || '').trim(),
        'target_type': targetType,
        'target_id': targetId,
        'inheritance_mode': 'override',
        'updated_at_utc': String(assign.assignedAt || new Date().toISOString()).trim(),
        'active': true
      };
      if (assign.id) {
        rowObj['assignment_id'] = String(assign.id).trim();
      }
      return rowObj;
    }, ['slot_key', 'asset_id']);

    if (!upsertRes.ok) return upsertRes;

    return {
      ok: true,
      success: true,
      message: 'Призначення зображень збережено в Google Таблиці.',
      timestamp: new Date().toISOString()
    };
  }, spreadsheetInput);
}

/**
 * Explicit additive setup operation to add image_url column to «Бібліотека зображень».
 * Only executes when explicitly called; never runs automatically.
 */
function gasSetupAddImageUrlColumn(spreadsheetInput) {
  return withUserWriteLock(function(ss) {
    var sheet = ss.getSheetByName('Бібліотека зображень');
    if (!sheet) {
      return { ok: false, success: false, code: 'SHEET_NOT_FOUND', error: 'Аркуш «Бібліотека зображень» не знайдено.' };
    }

    var lastCol = sheet.getLastColumn();
    if (lastCol <= 0) {
      return { ok: false, success: false, code: 'EMPTY_SHEET', error: 'Аркуш порожній.' };
    }

    var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < rawHeaders.length; i++) {
      if (rawHeaders[i] && rawHeaders[i].toString().trim().toLowerCase() === 'image_url') {
        return { ok: true, success: true, message: 'Стовпець image_url уже існує на аркуші «Бібліотека зображень».' };
      }
    }

    var newColIndex = lastCol + 1;
    sheet.getRange(1, newColIndex).setValue('image_url');
    return {
      ok: true,
      success: true,
      message: 'Стовпець image_url успішно додано до аркуша «Бібліотека зображень» (стовпець ' + newColIndex + ').',
      timestamp: new Date().toISOString()
    };
  }, spreadsheetInput);
}

/* ============================================================================
 * Internal Entity Readers & Writers using Canonical Headers
 * ========================================================================== */

function readEmployeesResult(ss, libData) {
  var sheet = ss.getSheetByName('Працівники');
  if (!sheet) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Канонічний аркуш «Працівники» не знайдено в таблиці. Завантаження заблоковано.',
      employees: []
    };
  }
  var res = readCanonicalSheetObjects(sheet, ['employee_id', 'name']);
  if (!res.ok) {
    return {
      ok: false,
      code: res.code,
      error: res.error,
      employees: []
    };
  }

  var employees = (res.objects || []).map(function(emp) {
    var empId = formatSheetCell(emp['employee_id'], 'text').trim();
    var statusRaw = formatSheetCell(emp['status'], 'text').toLowerCase();
    var status = statusRaw === 'archived' ? 'archived' : 'active';
    var rawAvatar = formatSheetCell(emp['avatar_asset_id'], 'text').trim();
    var rawPortrait = formatSheetCell(emp['portrait_asset_id'], 'text').trim();
    return {
      id: empId,
      name: formatSheetCell(emp['name'], 'text').trim(),
      role: formatSheetCell(emp['role'], 'text').trim(),
      status: status,
      avatarUrl: empId ? resolveRefUrlServer(rawAvatar, 'images/team/avatars/' + empId, libData) : cleanImageRef(rawAvatar),
      portraitUrl: empId ? resolveRefUrlServer(rawPortrait, 'images/team/portraits/' + empId, libData) : cleanImageRef(rawPortrait),
      notes: formatSheetCell(emp['notes'], 'text').trim(),
      createdAt: formatSheetCell(emp['created_at_utc'], 'text').trim() || '',
      updatedAt: formatSheetCell(emp['updated_at_utc'], 'text').trim() || ''
    };
  }).filter(function(emp) {
    return Boolean(emp.id && emp.name);
  });

  return { ok: true, employees: employees };
}

function readEmployees(ss) {
  var res = readEmployeesResult(ss, null);
  return res.ok ? res.employees : [];
}

function readRatingsResult(ss, employeeIdFilter) {
  var sheet = ss.getSheetByName('Оцінки');
  if (!sheet) {
    return {
      ok: false,
      code: 'SCHEMA_COMPATIBILITY_BLOCKED',
      error: 'Канонічний аркуш «Оцінки» не знайдено в таблиці. Завантаження заблоковано.',
      ratings: []
    };
  }
  var res = readCanonicalSheetObjects(sheet, ['rating_id', 'employee_id', 'score']);
  if (!res.ok) {
    return {
      ok: false,
      code: res.code,
      error: res.error,
      ratings: []
    };
  }

  var filterId = employeeIdFilter ? employeeIdFilter.toString().trim() : '';
  var list = (res.objects || []).map(function(r) {
    var deletedAt = formatSheetCell(pickObjField(r, ['deleted_at_utc']), 'text').trim();
    var recStatus = formatSheetCell(pickObjField(r, ['record_status']), 'text').trim().toLowerCase();
    if (deletedAt || recStatus === 'deleted' || recStatus === 'archived') return null;

    var scoreNum = Number(String(r['score'] !== undefined && r['score'] !== null ? r['score'] : '').trim());
    var meta = getRatingMetaServer(scoreNum) || {
      score: 3,
      emoji: '😐',
      sentiment: 'neutral',
      label: 'Нейтрально'
    };

    var rawRatedCell = pickObjField(r, ['rated_at_utc']);
    var ratedUtc = '';
    var dateVal = '';
    var timeVal = '';

    if (rawRatedCell !== '' && rawRatedCell !== null && rawRatedCell !== undefined) {
      if (Object.prototype.toString.call(rawRatedCell) === '[object Date]' && !isNaN(rawRatedCell.getTime())) {
        ratedUtc = rawRatedCell.toISOString();
        dateVal = Utilities.formatDate(rawRatedCell, 'Europe/Kyiv', 'yyyy-MM-dd');
        timeVal = Utilities.formatDate(rawRatedCell, 'Europe/Kyiv', 'HH:mm');
      } else {
        var ratedStr = String(rawRatedCell).trim();
        if (ratedStr) {
          var parsedRated = new Date(ratedStr);
          if (!isNaN(parsedRated.getTime())) {
            ratedUtc = parsedRated.toISOString();
            dateVal = Utilities.formatDate(parsedRated, 'Europe/Kyiv', 'yyyy-MM-dd');
            timeVal = Utilities.formatDate(parsedRated, 'Europe/Kyiv', 'HH:mm');
          }
        }
      }
    }

    if (!dateVal) {
      var explicitDate = formatSheetCell(pickObjField(r, ['rating_date', 'дата оцінки', 'дата']), 'date').trim();
      if (explicitDate) {
        dateVal = explicitDate.split('T')[0];
      }
    }
    if (!timeVal) {
      var explicitTime = formatSheetCell(pickObjField(r, ['rating_time', 'час оцінки', 'час']), 'time').trim();
      if (explicitTime) {
        var tMatch = /^(\d{1,2}):(\d{2})/.exec(explicitTime);
        if (tMatch) {
          timeVal = (tMatch[1].length === 1 ? '0' + tMatch[1] : tMatch[1]) + ':' + tMatch[2];
        }
      }
    }

    var createdAtStr = formatSheetCell(pickObjField(r, ['created_at_utc', 'створено utc']), 'text').trim();
    if (!dateVal && createdAtStr) {
      var parsedCreated = new Date(createdAtStr);
      if (!isNaN(parsedCreated.getTime())) {
        dateVal = Utilities.formatDate(parsedCreated, 'Europe/Kyiv', 'yyyy-MM-dd');
        if (!timeVal) {
          timeVal = Utilities.formatDate(parsedCreated, 'Europe/Kyiv', 'HH:mm');
        }
      }
    }

    if (!dateVal) {
      dateVal = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');
    }
    if (!timeVal) {
      timeVal = '12:00';
    }
    if (!ratedUtc) {
      ratedUtc = localKyivDateTimeToUtcIso(dateVal, timeVal) || '';
    }

    var commentVal = formatSheetCell(pickObjField(r, ['comment', 'коментар']), 'text').trim();
    return {
      id: formatSheetCell(r['rating_id'], 'text').trim(),
      employeeId: formatSheetCell(r['employee_id'], 'text').trim(),
      score: meta.score,
      emoji: meta.emoji,
      sentiment: meta.sentiment,
      label: meta.label,
      comment: commentVal,
      date: dateVal,
      time: timeVal,
      ratedAtUtc: ratedUtc || undefined,
      createdAt: createdAtStr || ratedUtc || '',
      updatedAt: formatSheetCell(pickObjField(r, ['updated_at_utc', 'оновлено utc']), 'text').trim() || createdAtStr || ''
    };
  }).filter(function(r) {
    if (!r || !r.id || !r.employeeId) return false;
    if (filterId && r.employeeId !== filterId) return false;
    return true;
  });

  list.sort(function(a, b) {
    var ka = (a.date || '') + 'T' + (a.time || '00:00') + '|' + (a.createdAt || '');
    var kb = (b.date || '') + 'T' + (b.time || '00:00') + '|' + (b.createdAt || '');
    return kb.localeCompare(ka);
  });
  return { ok: true, ratings: list };
}

function readRatings(ss, employeeIdFilter) {
  var res = readRatingsResult(ss, employeeIdFilter);
  return res.ok ? res.ratings : [];
}

function saveEmployeeRecord(ss, employee) {
  var empId = employee.id ? employee.id.toString().trim() : '';
  var empName = employee.name ? employee.name.toString().trim() : '';
  if (!empId || empId.length > 80) {
    return { ok: false, success: false, code: 'INVALID_EMPLOYEE_ID', error: 'Некоректний або відсутній ID співробітника.' };
  }
  if (!empName || empName.length > 80) {
    return { ok: false, success: false, code: 'INVALID_EMPLOYEE_NAME', error: "Вкажіть коректне ім'я співробітника (до 80 символів)." };
  }

  var statusVal = employee.status ? employee.status.toString().trim() : 'active';
  var existingRes = readEmployeesResult(ss, null);
  if (!existingRes.ok) {
    return { ok: false, success: false, code: existingRes.code, error: existingRes.error };
  }
  var existing = existingRes.employees;
  if (employee.createOnly === true) {
    var existingSameId = existing.some(function(item) { return item.id === empId; });
    if (existingSameId) {
      return { ok: false, success: false, code: 'DUPLICATE_EMPLOYEE_ID', error: 'Співробітник із таким ID уже існує.' };
    }
  }

  var dupName = existing.some(function(item) {
    return item.id !== empId && item.name.toLowerCase() === empName.toLowerCase();
  });
  if (dupName) {
    return { ok: false, success: false, code: 'DUPLICATE_EMPLOYEE_NAME', error: 'Співробітник з таким іменем уже існує.' };
  }

  var nowIso = new Date().toISOString();
  var prevMatch = null;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].id === empId) {
      prevMatch = existing[i];
      break;
    }
  }

  var normalized = {
    id: empId,
    name: empName,
    role: employee.role ? employee.role.toString().trim() : '',
    status: statusVal,
    avatarUrl: cleanImageRef(employee.avatarUrl),
    portraitUrl: cleanImageRef(employee.portraitUrl),
    notes: employee.notes ? employee.notes.toString().trim() : '',
    createdAt: (prevMatch && prevMatch.createdAt) || (employee.createdAt ? employee.createdAt.toString() : nowIso),
    updatedAt: nowIso
  };

  var sheet = ss.getSheetByName('Працівники');
  if (!sheet) {
    return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Працівники» не знайдено.' };
  }

  var upRes = upsertCanonicalRows(sheet, 'employee_id', [normalized], function(emp) {
    return {
      'employee_id': emp.id,
      'name': emp.name,
      'role': emp.role,
      'status': emp.status,
      'avatar_asset_id': emp.avatarUrl,
      'portrait_asset_id': emp.portraitUrl,
      'notes': emp.notes,
      'created_at_utc': emp.createdAt,
      'updated_at_utc': emp.updatedAt,
      'archived_at_utc': emp.status === 'archived' ? emp.updatedAt : ''
    };
  }, ['employee_id', 'name']);

  if (!upRes.ok) return upRes;

  return {
    ok: true,
    success: true,
    employee: normalized,
    message: 'Профіль співробітника збережено в Google Таблиці.',
    timestamp: nowIso
  };
}

function archiveEmployeeRecord(ss, employeeId) {
  var existingRes = readEmployeesResult(ss, null);
  if (!existingRes.ok) {
    return { ok: false, success: false, code: existingRes.code, error: existingRes.error };
  }
  var existing = existingRes.employees;
  var found = null;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].id === employeeId) {
      found = existing[i];
      break;
    }
  }
  if (!found) {
    return {
      ok: false,
      success: false,
      code: 'EMPLOYEE_NOT_FOUND',
      error: 'Співробітника з вказаним ID не знайдено в таблиці.'
    };
  }

  var nowIso = new Date().toISOString();
  found.status = 'archived';
  found.updatedAt = nowIso;

  var sheet = ss.getSheetByName('Працівники');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Працівники» не знайдено.' };

  var upRes = upsertCanonicalRows(sheet, 'employee_id', [found], function(emp) {
    return {
      'employee_id': emp.id,
      'status': 'archived',
      'updated_at_utc': nowIso,
      'archived_at_utc': nowIso
    };
  }, ['employee_id']);

  if (!upRes.ok) return upRes;

  return {
    ok: true,
    success: true,
    employee: found,
    message: 'Співробітника переведено в архів.',
    timestamp: nowIso
  };
}

function saveRatingRecord(ss, rating) {
  var ratingId = rating.id ? rating.id.toString().trim() : '';
  var empId = rating.employeeId ? rating.employeeId.toString().trim() : '';
  if (!ratingId) {
    return { ok: false, success: false, code: 'INVALID_RATING_ID', error: 'Відсутній ID оцінки.' };
  }
  if (!empId) {
    return { ok: false, success: false, code: 'INVALID_EMPLOYEE_ID', error: 'Оцінка повинна містити ID співробітника.' };
  }

  var meta = getRatingMetaServer(rating.score);
  if (!meta) {
    return {
      ok: false,
      success: false,
      code: 'INVALID_RATING_SCORE',
      error: 'Оцінка має бути цілим числом від 1 до 5.'
    };
  }

  var sheet = ss.getSheetByName('Оцінки');
  if (!sheet) {
    return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Оцінки» не знайдено.' };
  }

  var nowIso = new Date().toISOString();
  var dateStr = rating.date ? rating.date.toString().trim() : Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');
  var timeStr = rating.time ? rating.time.toString().trim() : '12:00';
  var ratedUtc = rating.ratedAtUtc || localKyivDateTimeToUtcIso(dateStr, timeStr) || nowIso;

  var normalized = {
    id: ratingId,
    employeeId: empId,
    score: meta.score,
    emoji: meta.emoji,
    sentiment: meta.sentiment,
    label: meta.label,
    comment: rating.comment ? rating.comment.toString().trim() : '',
    date: dateStr,
    time: timeStr,
    ratedAtUtc: ratedUtc,
    createdAt: rating.createdAt ? rating.createdAt.toString() : nowIso,
    updatedAt: nowIso
  };

  var upRes = upsertCanonicalRows(sheet, 'rating_id', [normalized], function(r) {
    return {
      'rating_id': r.id,
      'employee_id': r.employeeId,
      'score': r.score,
      'emoji': r.emoji,
      'sentiment': r.sentiment,
      'label': r.label,
      'comment': r.comment,
      'rated_at_utc': r.ratedAtUtc,
      'rating_date': r.date,
      'rating_time': r.time,
      'created_at_utc': r.createdAt,
      'updated_at_utc': r.updatedAt,
      'deleted_at_utc': '',
      'record_status': 'active',
      'source': 'allonsy_ui'
    };
  }, ['rating_id', 'employee_id', 'score']);

  if (!upRes.ok) return upRes;

  return {
    ok: true,
    success: true,
    rating: normalized,
    message: 'Оцінку ефективності збережено в Google Таблиці.',
    timestamp: nowIso
  };
}

function updateEmployees(ss, employees) {
  if (!employees || !Array.isArray(employees)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Працівники');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Працівники» відсутній.' };

  return upsertCanonicalRows(sheet, 'employee_id', employees, function(emp) {
    return {
      'employee_id': String(emp.id).trim(),
      'name': String(emp.name).trim(),
      'role': emp.role ? String(emp.role).trim() : '',
      'status': emp.status === 'archived' ? 'archived' : 'active',
      'avatar_asset_id': cleanImageRef(emp.avatarUrl),
      'portrait_asset_id': cleanImageRef(emp.portraitUrl),
      'notes': emp.notes ? String(emp.notes).trim() : '',
      'created_at_utc': emp.createdAt || new Date().toISOString(),
      'updated_at_utc': emp.updatedAt || new Date().toISOString()
    };
  }, ['employee_id', 'name']);
}

function updateRatings(ss, ratings) {
  if (!ratings || !Array.isArray(ratings)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Оцінки');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Оцінки» відсутній.' };

  var nowIso = new Date().toISOString();
  return upsertCanonicalRows(sheet, 'rating_id', ratings, function(r) {
    var meta = getRatingMetaServer(r.score) || { score: 3, emoji: '😐', sentiment: 'neutral', label: 'Нейтрально' };
    var dateVal = r.date || Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');
    var timeVal = r.time || '12:00';
    var ratedUtc = r.ratedAtUtc || localKyivDateTimeToUtcIso(dateVal, timeVal) || nowIso;
    return {
      'rating_id': String(r.id).trim(),
      'employee_id': String(r.employeeId).trim(),
      'score': meta.score,
      'emoji': meta.emoji,
      'sentiment': meta.sentiment,
      'label': meta.label,
      'comment': r.comment ? String(r.comment).trim() : '',
      'rated_at_utc': ratedUtc,
      'rating_date': dateVal,
      'rating_time': timeVal,
      'created_at_utc': r.createdAt || nowIso,
      'updated_at_utc': r.updatedAt || nowIso,
      'deleted_at_utc': '',
      'record_status': 'active',
      'source': 'allonsy_ui'
    };
  }, ['rating_id', 'employee_id', 'score']);
}

function updateCategories(ss, categories) {
  if (!categories || !Array.isArray(categories)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Категорії');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Категорії» відсутній.' };

  return upsertCanonicalRows(sheet, 'id', categories, function(c) {
    return {
      'id': String(c.id).trim(),
      'назва': String(c.name).trim(),
      'іконка_lucide': c.icon ? String(c.icon).trim() : '',
      'колір_hex': c.color ? String(c.color).trim() : '#f97316',
      'активна': true,
      'порядок': 1,
      'опис': ''
    };
  }, ['id', 'назва']);
}

function updateActionTypes(ss, actionTypes) {
  if (!actionTypes || !Array.isArray(actionTypes)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Типи дій');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Типи дій» відсутній.' };

  return upsertCanonicalRows(sheet, 'id', actionTypes, function(a) {
    return {
      'id': String(a.id).trim(),
      'назва': String(a.name).trim(),
      'активна': true,
      'порядок': 1
    };
  }, ['id', 'назва']);
}

function updateProjects(ss, projects) {
  if (!projects || !Array.isArray(projects)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Проєкти');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Проєкти» відсутній.' };

  return upsertCanonicalRows(sheet, 'id', projects, function(p) {
    return {
      'id': String(p.id).trim(),
      'назва': String(p.name).trim(),
      'активний': p.status === 'active',
      'порядок': 1
    };
  }, ['id', 'назва']);
}

function updateBonuses(ss, bonuses) {
  if (!bonuses || !Array.isArray(bonuses)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Бонуси');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Бонуси» відсутній.' };

  return upsertCanonicalRows(sheet, 'id', bonuses, function(b) {
    return {
      'id': String(b.id).trim(),
      'назва': String(b.name).trim(),
      'тип': b.rewardType || 'custom',
      'ціна_балів': Math.max(0, Math.round(Number(b.requiredPoints) || 0)),
      'опис': b.description ? String(b.description).trim() : '',
      'активний': b.isActive !== false,
      'порядок': 1,
      'image_asset_id': b.imageUrl && b.imageUrl.indexOf('http') === -1 ? b.imageUrl : ''
    };
  }, ['id', 'назва', 'ціна_балів']);
}

function updatePhrases(ss, phrases) {
  if (!phrases || !Array.isArray(phrases)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Фрази');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Фрази» відсутній.' };

  var headerRes = getValidatedHeaderMapWithAliases(sheet, [['id'], ['текст', 'фраза', 'text']]);
  if (!headerRes.ok) return headerRes;

  var colMap = headerRes.colMap;
  var textCol = colMap['текст'] !== undefined ? 'текст' : (colMap['фраза'] !== undefined ? 'фраза' : 'text');
  var activeCol = colMap['активна'] !== undefined ? 'активна' : (colMap['активний'] !== undefined ? 'активний' : (colMap['active'] !== undefined ? 'active' : 'is_active'));
  var orderCol = colMap['порядок'] !== undefined ? 'порядок' : (colMap['sort_order'] !== undefined ? 'sort_order' : 'order');

  return upsertCanonicalRows(sheet, 'id', phrases, function(p) {
    var row = {};
    row['id'] = String(p.id).trim();
    row[textCol] = String(p.text || '').trim();
    row[activeCol] = p.isActive !== false;
    row[orderCol] = Number(p.order) || 1;
    return row;
  }, ['id', textCol]);
}

function updateMotivationalPhrases(ss, phrases) {
  if (!phrases || !Array.isArray(phrases)) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Мотиваційні фрази');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Мотиваційні фрази» відсутній.' };

  var headerRes = getValidatedHeaderMapWithAliases(sheet, [['id'], ['template', 'шаблон', 'текст', 'фраза', 'text']]);
  if (!headerRes.ok) return headerRes;

  var colMap = headerRes.colMap;
  var textCol = colMap['template'] !== undefined ? 'template' : (colMap['шаблон'] !== undefined ? 'шаблон' : (colMap['текст'] !== undefined ? 'текст' : 'text'));
  var activeCol = colMap['active'] !== undefined ? 'active' : (colMap['активна'] !== undefined ? 'активна' : (colMap['активний'] !== undefined ? 'активний' : 'is_active'));
  var orderCol = colMap['sort_order'] !== undefined ? 'sort_order' : (colMap['порядок'] !== undefined ? 'порядок' : 'order');

  return upsertCanonicalRows(sheet, 'id', phrases, function(m) {
    var row = {};
    row['id'] = String(m.id).trim();
    row[textCol] = String(m.template || '').trim();
    row[activeCol] = m.isActive !== false;
    row[orderCol] = Number(m.order) || 1;
    row['updated_at_utc'] = new Date().toISOString();
    return row;
  }, ['id', textCol]);
}

function updateSettings(ss, settings) {
  if (!settings) return { ok: true, success: true };
  var sheet = ss.getSheetByName('Налаштування');
  if (!sheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Налаштування» відсутній.' };

  var items = [];
  var descriptions = {
    hourlyRate: 'Погодинна ставка opportunity cost ($)',
    targetHours: 'Цільова кількість робочих годин',
    progressionMode: 'Режим прогресії персонажа',
    bubbleDurationMs: 'Тривалість відображення мовної бульбашки (мс)',
    motivationRotationMinutes: 'Період ротації мотиваційних фраз (хв)',
    minutesPerPoint: 'Кількість хвилин за 1 бал винагороди',
    imageProgressionEnabled: 'Увімкнути зміну зображень за прогресом',
    pointsEligibleCategoryIds: 'Категорії часу, що нараховують бали (JSON масив ID)'
  };

  Object.keys(settings).forEach(function(key) {
    if (key === 'stages' || key === 'googleSheetsWebhookUrl' || key === 'googleSpreadsheetInput' || key === 'googleSpreadsheetId') return;
    if (settings[key] === undefined) return;
    var val = settings[key];
    var serialized = Array.isArray(val) ? JSON.stringify(val) : String(val);
    items.push({
      key: key,
      value: serialized,
      type: Array.isArray(val) ? 'json' : typeof val,
      desc: descriptions[key] || ''
    });
  });

  return upsertCanonicalRows(sheet, 'ключ', items, function(item) {
    return {
      'ключ': item.key,
      'значення': item.value,
      'тип': item.type,
      'опис': item.desc
    };
  }, ['ключ', 'значення']);
}

/* ============================================================================
 * Role-Based Points & Rewards Server Readers, Authorization & Commands
 * ========================================================================== */

function getVerifiedCallerEmail_() {
  try {
    if (typeof Session !== 'undefined' && Session && typeof Session.getActiveUser === 'function') {
      var user = Session.getActiveUser();
      if (user && typeof user.getEmail === 'function') {
        return String(user.getEmail() || '').trim().toLowerCase();
      }
    }
  } catch (err) {}
  return '';
}

function getSpreadsheetAdminEmails_(ss) {
  var adminSet = {};
  try {
    if (ss && typeof ss.getOwner === 'function') {
      var owner = ss.getOwner();
      if (owner && typeof owner.getEmail === 'function') {
        var oe = String(owner.getEmail() || '').trim().toLowerCase();
        if (oe) adminSet[oe] = true;
      }
    }
    if (ss && typeof ss.getEditors === 'function') {
      var editors = ss.getEditors() || [];
      for (var i = 0; i < editors.length; i++) {
        if (editors[i] && typeof editors[i].getEmail === 'function') {
          var ee = String(editors[i].getEmail() || '').trim().toLowerCase();
          if (ee) adminSet[ee] = true;
        }
      }
    }
  } catch (err) {}
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
      var extra = String(PropertiesService.getScriptProperties().getProperty('POINTS_ADMIN_EMAILS') || '').trim();
      if (extra) {
        var parts = extra.split(/[,;\s]+/);
        for (var j = 0; j < parts.length; j++) {
          var pe = String(parts[j] || '').trim().toLowerCase();
          if (pe) adminSet[pe] = true;
        }
      }
    }
  } catch (err2) {}
  return adminSet;
}

function verifyPrivilegedPointsCaller_(ss) {
  var email = getVerifiedCallerEmail_();
  if (!email) {
    return {
      ok: false,
      success: false,
      code: 'AUTH_REQUIRED_PRIVILEGED_MUTATION',
      error: 'Операцію заблоковано: поточне анонімне веб-розгортання Apps Script (Anyone / /api/gas-proxy) не передає підтверджену особу Google (Session.getActiveUser().getEmail() порожній). Призначена роль балів у таблиці не надає прав адміністратора.'
    };
  }
  var adminEmails = getSpreadsheetAdminEmails_(ss);
  if (!adminEmails[email]) {
    return {
      ok: false,
      success: false,
      code: 'FORBIDDEN_PRIVILEGED_MUTATION',
      error: 'Доступ заборонено: обліковий запис ' + email + ' не є власником або редактором цієї Google Таблиці.'
    };
  }
  return { ok: true, isAdmin: true, email: email };
}

function verifyPointsSelfOrAdminCaller_(ss, targetEmployeeId) {
  var email = getVerifiedCallerEmail_();
  if (!email) {
    return {
      ok: false,
      success: false,
      code: 'AUTH_REQUIRED_PRIVILEGED_MUTATION',
      error: 'Операцію отримання бонусу заблоковано: анонімний виклик Apps Script не підтверджує особу користувача (Session.getActiveUser().getEmail() порожній).'
    };
  }
  var adminEmails = getSpreadsheetAdminEmails_(ss);
  if (adminEmails[email]) {
    return { ok: true, isAdmin: true, email: email };
  }
  var empSheet = ss.getSheetByName('Працівники');
  if (empSheet) {
    var empRes = readCanonicalSheetObjects(empSheet, ['employee_id', 'name']);
    if (empRes.ok && empRes.objects) {
      for (var i = 0; i < empRes.objects.length; i++) {
        var row = empRes.objects[i];
        var rowEmpId = formatSheetCell(row['employee_id'], 'text').trim();
        var rowEmail = formatSheetCell(pickObjField(row, ['email', 'google_email']), 'text').trim().toLowerCase();
        if (rowEmpId === targetEmployeeId && rowEmail && rowEmail === email) {
          return { ok: true, isAdmin: false, email: email };
        }
      }
    }
  }
  return {
    ok: false,
    success: false,
    code: 'FORBIDDEN_CROSS_EMPLOYEE_MUTATION',
    error: 'Доступ заборонено: ваш обліковий запис (' + email + ') не підтверджено для дій від імені співробітника ' + targetEmployeeId + '.'
  };
}

function normalizeNullableNumServer_(val) {
  if (val === undefined || val === null || val === '') return null;
  var s = String(val).trim();
  if (!s) return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

function normalizeNullableBoolServer_(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'boolean') return val;
  var s = String(val).trim().toLowerCase();
  if (!s) return null;
  if (s === 'true' || s === '1' || s === 'так') return true;
  if (s === 'false' || s === '0' || s === 'ні') return false;
  return null;
}

function kyivMonthKeyServer_(isoOrDate) {
  try {
    var d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return Utilities.formatDate(d, 'Europe/Kyiv', 'yyyy-MM');
  } catch (err) {
    return new Date().toISOString().slice(0, 7);
  }
}

function computePositiveExpiryUtcServer_(monthKey, graceMonths) {
  var grace = !isNaN(Number(graceMonths)) ? Math.max(0, Math.floor(Number(graceMonths))) : 1;
  var parts = /^(\d{4})-(\d{2})$/.exec(String(monthKey || '').trim());
  var nowMk = kyivMonthKeyServer_(new Date());
  var baseY = parts ? Number(parts[1]) : Number(nowMk.slice(0, 4));
  var baseM = parts ? Number(parts[2]) : Number(nowMk.slice(5, 7));
  var zeroIdx = baseY * 12 + (baseM - 1) + grace + 1;
  var expY = Math.floor(zeroIdx / 12);
  var expM = ((zeroIdx % 12) + 12) % 12 + 1;
  var expDate = expY + '-' + (expM < 10 ? '0' + expM : String(expM)) + '-01';
  try {
    return Utilities.parseDate(expDate + ' 00:00:00', 'Europe/Kyiv', 'yyyy-MM-dd HH:mm:ss').toISOString();
  } catch (err) {
    return expDate + 'T00:00:00.000Z';
  }
}

function readPointsAndRewardsBundleServer_(ss) {
  var specs = [
    { name: 'Ролі балів', required: ['role_id', 'назва'], key: 'roles' },
    { name: 'Профілі балів', required: ['employee_id', 'points_role'], key: 'profiles' },
    { name: 'Причини балів', required: ['reason_id', 'operation_type', 'назва'], key: 'reasons' },
    { name: 'Операції балів', required: ['transaction_id', 'employee_id', 'operation_type', 'points_delta'], key: 'transactions' },
    { name: 'Періоди балів', required: ['period_id', 'employee_id', 'month_key'], key: 'periods' },
    { name: 'Доступність бонусів', required: ['eligibility_id', 'bonus_id', 'target_type'], key: 'eligibility' }
  ];

  var missingSheets = [];
  var blockedSheets = [];
  var rawByKey = { roles: [], profiles: [], reasons: [], transactions: [], periods: [], eligibility: [] };

  for (var i = 0; i < specs.length; i++) {
    var spec = specs[i];
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) {
      missingSheets.push(spec.name);
      continue;
    }
    var res = readCanonicalSheetObjects(sheet, spec.required);
    if (!res.ok) {
      blockedSheets.push(spec.name);
      return { ok: false, code: res.code, error: res.error };
    }
    rawByKey[spec.key] = res.objects || [];
  }

  var pointsRoles = rawByKey.roles.map(function(r) {
    var rId = formatSheetCell(r['role_id'], 'text').trim().toLowerCase() === 'manager' ? 'manager' : 'performer';
    var modeRaw = formatSheetCell(r['eligible_time_mode'], 'text').trim().toLowerCase();
    var mode = (modeRaw === 'selected_categories' || modeRaw === 'eligible_only') ? modeRaw : 'all';
    return {
      roleId: rId,
      name: formatSheetCell(r['назва'], 'text').trim() || (rId === 'manager' ? 'Керівник' : 'Виконавець'),
      description: formatSheetCell(r['опис'], 'text').trim(),
      monthlyBasePoints: Math.max(0, Number(r['monthly_base_points']) || 0),
      timeEarningEnabled: parseCanonicalBool(r['time_earning_enabled'], rId === 'manager'),
      minutesPerPoint: Math.max(1, Number(r['minutes_per_point']) || 30),
      eligibleTimeMode: mode,
      positiveGraceMonths: Math.max(0, Math.floor(Number(r['positive_grace_months'] !== '' ? r['positive_grace_months'] : 1) || 0)),
      negativeCarryover: parseCanonicalBool(r['negative_carryover'], true),
      active: parseCanonicalBool(r['active'], true),
      updatedAtUtc: formatSheetCell(r['updated_at_utc'], 'text').trim()
    };
  });

  var pointsProfiles = rawByKey.profiles.map(function(p) {
    var empId = formatSheetCell(p['employee_id'], 'text').trim();
    if (!empId) return null;
    var roleRaw = formatSheetCell(p['points_role'], 'text').trim().toLowerCase();
    return {
      employeeId: empId,
      pointsRole: (roleRaw === 'manager' || roleRaw === 'керівник') ? 'manager' : 'performer',
      monthlyBaseOverride: normalizeNullableNumServer_(p['monthly_base_override']),
      timeEarningOverride: normalizeNullableBoolServer_(p['time_earning_override']),
      minutesPerPointOverride: normalizeNullableNumServer_(p['minutes_per_point_override']),
      pointsEnabled: parseCanonicalBool(p['points_enabled'], true),
      updatedAtUtc: formatSheetCell(p['updated_at_utc'], 'text').trim()
    };
  }).filter(Boolean);

  var pointsReasons = rawByKey.reasons.map(function(r, idx) {
    var id = formatSheetCell(r['reason_id'], 'text').trim();
    var name = formatSheetCell(r['назва'], 'text').trim();
    if (!id || !name) return null;
    var opRaw = formatSheetCell(r['operation_type'], 'text').trim().toLowerCase();
    var op = (opRaw === 'manual_award' || opRaw === 'manual_deduction' || opRaw === 'neutral_self_report')
      ? opRaw : 'neutral_self_report';
    var rolesStr = formatSheetCell(r['allowed_roles'], 'text').trim().toLowerCase();
    var allowed = [];
    if (!rolesStr || rolesStr === 'all' || rolesStr === '*') {
      allowed = ['manager', 'performer'];
    } else {
      if (rolesStr.indexOf('manager') !== -1 || rolesStr.indexOf('керівник') !== -1) allowed.push('manager');
      if (rolesStr.indexOf('performer') !== -1 || rolesStr.indexOf('виконавець') !== -1) allowed.push('performer');
      if (allowed.length === 0) allowed = ['manager', 'performer'];
    }
    var ord = Number(r['sort_order']);
    return {
      id: id,
      operationType: op,
      name: name,
      defaultPoints: op === 'neutral_self_report' ? 0 : Math.max(0, Number(r['default_points']) || 0),
      description: formatSheetCell(r['опис'], 'text').trim(),
      allowedRoles: allowed,
      active: parseCanonicalBool(r['active'], true),
      sortOrder: !isNaN(ord) && ord > 0 ? ord : (idx + 1),
      updatedAtUtc: formatSheetCell(r['updated_at_utc'], 'text').trim()
    };
  }).filter(Boolean);
  pointsReasons.sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

  var pointsTransactions = rawByKey.transactions.map(function(t) {
    var id = formatSheetCell(t['transaction_id'], 'text').trim();
    var empId = formatSheetCell(t['employee_id'], 'text').trim();
    if (!id || !empId) return null;
    var occ = formatSheetCell(t['occurred_at_utc'], 'text').trim();
    return {
      id: id,
      employeeId: empId,
      operationType: formatSheetCell(t['operation_type'], 'text').trim() || 'manual_award',
      pointsDelta: Number(t['points_delta']) || 0,
      reasonId: formatSheetCell(t['reason_id'], 'text').trim(),
      reasonSnapshot: formatSheetCell(t['reason_snapshot'], 'text').trim(),
      comment: formatSheetCell(t['comment'], 'text').trim(),
      projectId: formatSheetCell(t['project_id'], 'text').trim() || undefined,
      segmentId: formatSheetCell(t['segment_id'], 'text').trim() || undefined,
      relatedEmployeeId: formatSheetCell(t['related_employee_id'], 'text').trim() || undefined,
      occurredAtUtc: occ,
      createdAtUtc: formatSheetCell(t['created_at_utc'], 'text').trim() || occ,
      actorEmployeeId: formatSheetCell(t['actor_employee_id'], 'text').trim() || undefined,
      commandId: formatSheetCell(t['command_id'], 'text').trim() || ('cmd-' + id),
      reversalOfTransactionId: formatSheetCell(t['reversal_of_transaction_id'], 'text').trim() || undefined,
      monthKey: formatSheetCell(t['month_key'], 'text').trim() || (occ ? occ.slice(0, 7) : ''),
      expiresAtUtc: formatSheetCell(t['expires_at_utc'], 'text').trim() || undefined
    };
  }).filter(Boolean);

  var pointsPeriods = rawByKey.periods.map(function(p) {
    var id = formatSheetCell(p['period_id'], 'text').trim();
    var empId = formatSheetCell(p['employee_id'], 'text').trim();
    var mk = formatSheetCell(p['month_key'], 'text').trim();
    if (!id || !empId || !mk) return null;
    var stRaw = formatSheetCell(p['status'], 'text').trim().toLowerCase();
    return {
      id: id,
      employeeId: empId,
      monthKey: mk,
      baseAllocation: Number(p['base_allocation']) || 0,
      debtCarriedIn: Number(p['debt_carried_in']) || 0,
      earnedPoints: Number(p['earned_points']) || 0,
      deductedPoints: Number(p['deducted_points']) || 0,
      spentPoints: Number(p['spent_points']) || 0,
      expiredPoints: Number(p['expired_points']) || 0,
      status: (stRaw === 'closed' || stRaw === 'закрито') ? 'closed' : 'open',
      closedAtUtc: formatSheetCell(p['closed_at_utc'], 'text').trim() || undefined,
      commandId: formatSheetCell(p['command_id'], 'text').trim() || undefined
    };
  }).filter(Boolean);

  var bonusEligibility = rawByKey.eligibility.map(function(e) {
    var id = formatSheetCell(e['eligibility_id'], 'text').trim();
    var bonusId = formatSheetCell(e['bonus_id'], 'text').trim();
    if (!id || !bonusId) return null;
    var tt = formatSheetCell(e['target_type'], 'text').trim().toLowerCase();
    var targetType = (tt === 'employee' || tt === 'role') ? tt : 'all';
    return {
      id: id,
      bonusId: bonusId,
      targetType: targetType,
      targetId: formatSheetCell(e['target_id'], 'text').trim() || (targetType === 'all' ? '*' : ''),
      priceOverride: normalizeNullableNumServer_(e['price_override']),
      active: parseCanonicalBool(e['active'], true),
      requiresApproval: parseCanonicalBool(e['requires_approval'], false),
      maxQuantity: normalizeNullableNumServer_(e['max_quantity']),
      updatedAtUtc: formatSheetCell(pickObjField(e, ['updated_at_utc', 'updated']), 'text').trim()
    };
  }).filter(Boolean);

  return {
    ok: true,
    pointsRoles: pointsRoles,
    pointsProfiles: pointsProfiles,
    pointsReasons: pointsReasons,
    pointsTransactions: pointsTransactions,
    pointsPeriods: pointsPeriods,
    bonusEligibility: bonusEligibility,
    pointsAudit: {
      schemaReady: missingSheets.length === 0 && blockedSheets.length === 0,
      missingSheets: missingSheets,
      blockedSheets: blockedSheets
    }
  };
}

function appendChangeLogServer_(ss, entityType, entityId, action, beforeObj, afterObj, reason, commandId) {
  var sheet = ss.getSheetByName('Журнал змін');
  if (!sheet) return;
  var headerRes = getValidatedHeaderMap(sheet, ['audit_id', 'entity_type', 'entity_id', 'action']);
  if (!headerRes.ok) return;
  var nowIso = new Date().toISOString();
  var rowObj = {
    'audit_id': 'aud-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    'entity_type': entityType,
    'entity_id': entityId,
    'action': action,
    'before_json': beforeObj ? JSON.stringify(beforeObj) : '',
    'after_json': afterObj ? JSON.stringify(afterObj) : '',
    'reason': reason || '',
    'timestamp_utc': nowIso,
    'command_id': commandId || ''
  };
  upsertCanonicalRows(sheet, 'audit_id', [rowObj], function(r) { return r; }, ['audit_id']);
}

function computeAvailableBalanceServer_(employeeId, transactions, positiveGraceMonths, negativeCarryover) {
  var nowMs = Date.now();
  var empTxs = transactions
    .filter(function(tx) { return tx.employeeId === employeeId; })
    .sort(function(a, b) {
      var ka = (a.occurredAtUtc || '') + '|' + (a.createdAtUtc || '') + '|' + (a.id || '');
      var kb = (b.occurredAtUtc || '') + '|' + (b.createdAtUtc || '') + '|' + (b.id || '');
      return ka.localeCompare(kb);
    });

  var lots = [];
  var spentSlicesByTx = {};
  var debt = 0;

  function expireLots(cutoffMs) {
    for (var i = 0; i < lots.length; i++) {
      if (lots[i].rem > 0 && lots[i].expMs <= cutoffMs) {
        lots[i].rem = 0;
      }
    }
  }

  function addCredit(id, amt, mk, expUtc) {
    if (amt <= 0) return;
    var rem = amt;
    if (debt > 0 && negativeCarryover !== false) {
      var off = Math.min(rem, debt);
      debt -= off;
      rem -= off;
    }
    if (rem > 0) {
      var resolvedExp = expUtc || computePositiveExpiryUtcServer_(mk, positiveGraceMonths);
      var expMs = Date.parse(resolvedExp) || Number.MAX_SAFE_INTEGER;
      lots.push({ id: id, mk: mk, rem: rem, expUtc: resolvedExp, expMs: expMs });
    }
  }

  function consumeFifo(amt) {
    var slices = [];
    var rem = amt;
    var ordered = lots.filter(function(l) { return l.rem > 0; }).sort(function(a, b) { return a.expMs - b.expMs; });
    for (var i = 0; i < ordered.length; i++) {
      if (rem <= 0) break;
      var take = Math.min(rem, ordered[i].rem);
      if (take > 0) {
        ordered[i].rem -= take;
        rem -= take;
        slices.push({ id: ordered[i].id, mk: ordered[i].mk, amt: take, expUtc: ordered[i].expUtc, expMs: ordered[i].expMs });
      }
    }
    if (rem > 0) debt += rem;
    return slices;
  }

  for (var i = 0; i < empTxs.length; i++) {
    var tx = empTxs[i];
    var txMs = Date.parse(tx.occurredAtUtc || tx.createdAtUtc || '') || nowMs;
    expireLots(txMs);
    var delta = Number(tx.pointsDelta) || 0;
    var mk = tx.monthKey || kyivMonthKeyServer_(tx.occurredAtUtc);
    if (tx.operationType === 'neutral_self_report') continue;
    if (tx.operationType === 'monthly_allocation' || tx.operationType === 'time_earning' || tx.operationType === 'manual_award') {
      if (delta > 0) addCredit(tx.id, delta, mk, tx.expiresAtUtc || '');
    } else if (tx.operationType === 'manual_deduction') {
      if (Math.abs(delta) > 0) consumeFifo(Math.abs(delta));
    } else if (tx.operationType === 'reward_spend') {
      if (Math.abs(delta) > 0) spentSlicesByTx[tx.id] = consumeFifo(Math.abs(delta));
    } else if (tx.operationType === 'reward_refund') {
      var refAmt = Math.max(0, delta);
      var origSlices = tx.reversalOfTransactionId ? spentSlicesByTx[tx.reversalOfTransactionId] : null;
      if (origSlices && origSlices.length > 0) {
        var left = refAmt;
        for (var si = 0; si < origSlices.length && left > 0; si++) {
          var part = Math.min(left, origSlices[si].amt);
          left -= part;
          if (origSlices[si].expMs > txMs) {
            addCredit(tx.id + '-' + origSlices[si].id, part, origSlices[si].mk, origSlices[si].expUtc);
          }
        }
      }
    } else if (tx.operationType === 'reversal' || tx.operationType === 'period_correction') {
      if (delta > 0) {
        var rExp = tx.expiresAtUtc || computePositiveExpiryUtcServer_(mk, positiveGraceMonths);
        if ((Date.parse(rExp) || Number.MAX_SAFE_INTEGER) > txMs) addCredit(tx.id, delta, mk, rExp);
      } else if (delta < 0) {
        consumeFifo(Math.abs(delta));
      }
    }
  }
  expireLots(nowMs);
  var total = lots.reduce(function(s, l) { return s + l.rem; }, 0);
  return Math.max(0, total - debt);
}

function mapTxToCanonicalSheetRowServer_(tx) {
  return {
    'transaction_id': tx.id,
    'employee_id': tx.employeeId,
    'operation_type': tx.operationType,
    'points_delta': tx.pointsDelta,
    'reason_id': tx.reasonId || '',
    'reason_snapshot': tx.reasonSnapshot || '',
    'comment': tx.comment || '',
    'project_id': tx.projectId || '',
    'segment_id': tx.segmentId || '',
    'related_employee_id': tx.relatedEmployeeId || '',
    'occurred_at_utc': tx.occurredAtUtc,
    'created_at_utc': tx.createdAtUtc,
    'actor_employee_id': tx.actorEmployeeId || '',
    'command_id': tx.commandId,
    'reversal_of_transaction_id': tx.reversalOfTransactionId || '',
    'month_key': tx.monthKey,
    'expires_at_utc': tx.expiresAtUtc || ''
  };
}

function gasExecutePointsCommand(spreadsheetInput, arg1, arg2) {
  var cmd = (arg2 !== undefined && typeof arg1 === 'string') ? arg2 : arg1;
  if (!cmd || typeof cmd !== 'object' || !cmd.type) {
    return { ok: false, success: false, code: 'INVALID_POINTS_COMMAND', error: 'Некоректна команда системи балів.' };
  }

  return withUserWriteLock(function(ss) {
    var cmdType = String(cmd.type);
    var authRes = cmdType === 'claim_bonus'
      ? verifyPointsSelfOrAdminCaller_(ss, String(cmd.employeeId || '').trim())
      : verifyPrivilegedPointsCaller_(ss);
    if (!authRes.ok) {
      return authRes;
    }

    var nowIso = new Date().toISOString();
    var bundle = readPointsAndRewardsBundleServer_(ss);
    if (!bundle.ok) return bundle;

    var requireSheet = function(name) {
      var sh = ss.getSheetByName(name);
      if (!sh) {
        return {
          ok: false,
          success: false,
          code: 'SCHEMA_COMPATIBILITY_BLOCKED',
          error: 'Аркуш «' + name + '» не знайдено в Google Таблиці. Операцію заблоковано.'
        };
      }
      return { ok: true, sheet: sh };
    };

    if (cmdType === 'save_roles') {
      var rolesSh = requireSheet('Ролі балів');
      if (!rolesSh.ok) return rolesSh;
      var rolesList = Array.isArray(cmd.roles) ? cmd.roles : [];
      var upRoles = upsertCanonicalRows(rolesSh.sheet, 'role_id', rolesList, function(r) {
        return {
          'role_id': r.roleId,
          'назва': r.name,
          'опис': r.description || '',
          'monthly_base_points': Math.max(0, Number(r.monthlyBasePoints) || 0),
          'time_earning_enabled': Boolean(r.timeEarningEnabled),
          'minutes_per_point': Math.max(1, Number(r.minutesPerPoint) || 30),
          'eligible_time_mode': r.eligibleTimeMode || 'all',
          'positive_grace_months': Math.max(0, Math.floor(Number(r.positiveGraceMonths !== undefined ? r.positiveGraceMonths : 1))),
          'negative_carryover': r.negativeCarryover !== false,
          'active': r.active !== false,
          'updated_at_utc': nowIso
        };
      }, ['role_id', 'назва']);
      if (!upRoles.ok) return upRoles;
      if (Array.isArray(cmd.eligibleCategoryIds)) {
        var setUp = updateSettings(ss, { pointsEligibleCategoryIds: cmd.eligibleCategoryIds });
        if (!setUp.ok) return setUp;
      }
      appendChangeLogServer_(ss, 'points_roles', 'roles', 'update', bundle.pointsRoles, rolesList, 'Оновлення налаштувань ролей балів (' + authRes.email + ')', cmd.commandId || '');
      return { ok: true, success: true, message: 'Налаштування ролей балів збережено.' };
    }

    if (cmdType === 'save_profiles') {
      var profSh = requireSheet('Профілі балів');
      if (!profSh.ok) return profSh;
      var profList = Array.isArray(cmd.profiles) ? cmd.profiles : [];
      var upProf = upsertCanonicalRows(profSh.sheet, 'employee_id', profList, function(p) {
        return {
          'employee_id': p.employeeId,
          'points_role': p.pointsRole === 'manager' ? 'manager' : 'performer',
          'monthly_base_override': (p.monthlyBaseOverride !== null && p.monthlyBaseOverride !== undefined) ? p.monthlyBaseOverride : '',
          'time_earning_override': (p.timeEarningOverride !== null && p.timeEarningOverride !== undefined) ? p.timeEarningOverride : '',
          'minutes_per_point_override': (p.minutesPerPointOverride !== null && p.minutesPerPointOverride !== undefined) ? p.minutesPerPointOverride : '',
          'points_enabled': p.pointsEnabled !== false,
          'updated_at_utc': nowIso
        };
      }, ['employee_id', 'points_role']);
      if (!upProf.ok) return upProf;
      appendChangeLogServer_(ss, 'points_profiles', 'profiles', 'update', bundle.pointsProfiles, profList, 'Оновлення профілів балів (' + authRes.email + ')', cmd.commandId || '');
      return { ok: true, success: true, message: 'Профілі балів співробітників збережено.' };
    }

    if (cmdType === 'save_reasons') {
      var reasonSh = requireSheet('Причини балів');
      if (!reasonSh.ok) return reasonSh;
      var reasonList = Array.isArray(cmd.reasons) ? cmd.reasons : [];
      var upReason = upsertCanonicalRows(reasonSh.sheet, 'reason_id', reasonList, function(r) {
        return {
          'reason_id': r.id,
          'operation_type': r.operationType,
          'назва': r.name,
          'default_points': r.operationType === 'neutral_self_report' ? 0 : Math.max(0, Math.round(Number(r.defaultPoints) || 0)),
          'опис': r.description || '',
          'allowed_roles': Array.isArray(r.allowedRoles) ? r.allowedRoles.join(',') : 'manager,performer',
          'active': r.active !== false,
          'sort_order': Number(r.sortOrder) || 1,
          'updated_at_utc': nowIso
        };
      }, ['reason_id', 'operation_type', 'назва']);
      if (!upReason.ok) return upReason;
      appendChangeLogServer_(ss, 'points_reasons', 'reasons', 'update', bundle.pointsReasons, reasonList, 'Оновлення довідника причин (' + authRes.email + ')', cmd.commandId || '');
      return { ok: true, success: true, message: 'Довідник причин балів збережено.' };
    }

    if (cmdType === 'save_eligibility') {
      var eligSh = requireSheet('Доступність бонусів');
      if (!eligSh.ok) return eligSh;
      var eligList = Array.isArray(cmd.rules) ? cmd.rules : [];
      var upElig = upsertCanonicalRows(eligSh.sheet, 'eligibility_id', eligList, function(r) {
        return {
          'eligibility_id': r.id,
          'bonus_id': r.bonusId,
          'target_type': r.targetType,
          'target_id': r.targetId || (r.targetType === 'all' ? '*' : ''),
          'price_override': (r.priceOverride !== null && r.priceOverride !== undefined) ? r.priceOverride : '',
          'active': r.active !== false,
          'requires_approval': Boolean(r.requiresApproval),
          'max_quantity': (r.maxQuantity !== null && r.maxQuantity !== undefined) ? r.maxQuantity : '',
          'updated_at_utc': nowIso
        };
      }, ['eligibility_id', 'bonus_id', 'target_type']);
      if (!upElig.ok) return upElig;
      appendChangeLogServer_(ss, 'bonus_eligibility', 'rules', 'update', bundle.bonusEligibility, eligList, 'Оновлення доступності бонусів (' + authRes.email + ')', cmd.commandId || '');
      return { ok: true, success: true, message: 'Правила доступності бонусів збережено.' };
    }

    var txSh = requireSheet('Операції балів');
    if (!txSh.ok) return txSh;

    if (cmdType === 'manual_adjustment') {
      var empId = String(cmd.employeeId || '').trim();
      var opType = String(cmd.operationType || '');
      var reasonId = String(cmd.reasonId || '').trim();
      var comment = String(cmd.comment || '').trim();
      var customExplanation = String(cmd.customExplanation || '').trim();
      var commandId = String(cmd.commandId || '').trim();
      var occIso = String(cmd.occurredAtUtc || nowIso);
      var mk = kyivMonthKeyServer_(occIso);

      if (!empId || !comment) {
        return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Вкажіть співробітника та обов’язковий коментар.' };
      }
      if (reasonId === 'reason-other' && !customExplanation) {
        return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Для причини «Інше» потрібно вказати пояснення.' };
      }
      if (commandId && bundle.pointsTransactions.some(function(t) { return t.commandId === commandId; })) {
        return { ok: true, success: true, idempotent: true, message: 'Операцію вже виконано (idempotent command_id).' };
      }
      var isClosed = bundle.pointsPeriods.some(function(p) { return p.employeeId === empId && p.monthKey === mk && p.status === 'closed'; });
      if (isClosed) {
        return { ok: false, success: false, code: 'PERIOD_CLOSED', error: 'Період ' + mk + ' закрито. Зміни заборонено — скористайтесь корекцією в поточному періоді.' };
      }

      var delta = 0;
      if (opType === 'manual_award') delta = Math.max(1, Math.round(Number(cmd.amount) || 0));
      else if (opType === 'manual_deduction') delta = -Math.max(1, Math.round(Number(cmd.amount) || 0));
      else if (opType === 'neutral_self_report') delta = 0;
      else return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Невідомий тип операції.' };

      var prof = bundle.pointsProfiles.filter(function(p) { return p.employeeId === empId; })[0];
      var roleId = (prof && prof.pointsRole === 'manager') ? 'manager' : 'performer';
      var roleCfg = bundle.pointsRoles.filter(function(r) { return r.roleId === roleId; })[0];
      var grace = roleCfg ? roleCfg.positiveGraceMonths : 1;

      var newTx = {
        id: 'ptx-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        employeeId: empId,
        operationType: opType,
        pointsDelta: delta,
        reasonId: reasonId,
        reasonSnapshot: reasonId === 'reason-other' ? ('Інше: ' + customExplanation) : String(cmd.reasonSnapshot || 'Інше'),
        comment: comment,
        projectId: String(cmd.projectId || '').trim(),
        segmentId: String(cmd.segmentId || '').trim(),
        relatedEmployeeId: String(cmd.relatedEmployeeId || '').trim(),
        occurredAtUtc: occIso,
        createdAtUtc: nowIso,
        actorEmployeeId: authRes.email,
        commandId: commandId || ('cmd-' + Date.now()),
        reversalOfTransactionId: '',
        monthKey: mk,
        expiresAtUtc: delta > 0 ? computePositiveExpiryUtcServer_(mk, grace) : ''
      };

      var upTx = upsertCanonicalRows(txSh.sheet, 'transaction_id', [mapTxToCanonicalSheetRowServer_(newTx)], function(r) { return r; }, ['transaction_id', 'employee_id', 'operation_type', 'points_delta']);
      if (!upTx.ok) return upTx;
      appendChangeLogServer_(ss, 'points_transaction', newTx.id, 'create', null, newTx, newTx.reasonSnapshot, newTx.commandId);
      return { ok: true, success: true, transaction: newTx, message: 'Операцію балів збережено в журналі.' };
    }

    if (cmdType === 'reverse_transaction') {
      var targetId = String(cmd.transactionId || '').trim();
      var revComment = String(cmd.comment || '').trim();
      var revCmd = String(cmd.commandId || '').trim();
      if (!targetId || !revComment) {
        return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Вкажіть ID операції та причину сторнування.' };
      }
      if (revCmd && bundle.pointsTransactions.some(function(t) { return t.commandId === revCmd; })) {
        return { ok: true, success: true, idempotent: true, message: 'Сторно вже виконано.' };
      }
      var target = bundle.pointsTransactions.filter(function(t) { return t.id === targetId; })[0];
      if (!target) {
        return { ok: false, success: false, code: 'NOT_FOUND', error: 'Операцію для сторнування не знайдено.' };
      }
      if (target.operationType === 'reversal') {
        return { ok: false, success: false, code: 'INVALID_REVERSAL', error: 'Операцію сторнування не можна сторнувати повторно.' };
      }
      var revClosed = bundle.pointsPeriods.some(function(p) { return p.employeeId === target.employeeId && p.monthKey === target.monthKey && p.status === 'closed'; });
      if (revClosed) {
        return { ok: false, success: false, code: 'PERIOD_CLOSED', error: 'Період ' + target.monthKey + ' закрито. Сторнування в закритому періоді заборонено.' };
      }
      var revDelta = -Number(target.pointsDelta || 0);
      var revTx = {
        id: 'ptx-rev-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        employeeId: target.employeeId,
        operationType: 'reversal',
        pointsDelta: revDelta,
        reasonId: target.reasonId || '',
        reasonSnapshot: 'Сторно: ' + target.reasonSnapshot,
        comment: revComment,
        projectId: target.projectId || '',
        segmentId: target.segmentId || '',
        relatedEmployeeId: target.relatedEmployeeId || '',
        occurredAtUtc: nowIso,
        createdAtUtc: nowIso,
        actorEmployeeId: authRes.email,
        commandId: revCmd || ('rev-' + targetId + '-' + Date.now()),
        reversalOfTransactionId: target.id,
        monthKey: target.monthKey || kyivMonthKeyServer_(nowIso),
        expiresAtUtc: revDelta > 0 ? (target.expiresAtUtc || '') : ''
      };
      var upRev = upsertCanonicalRows(txSh.sheet, 'transaction_id', [mapTxToCanonicalSheetRowServer_(revTx)], function(r) { return r; }, ['transaction_id', 'employee_id', 'operation_type', 'points_delta']);
      if (!upRev.ok) return upRev;
      appendChangeLogServer_(ss, 'points_transaction', revTx.id, 'reverse', target, revTx, revComment, revTx.commandId);
      return { ok: true, success: true, transaction: revTx, message: 'Операцію сторновано.' };
    }

    if (cmdType === 'ensure_monthly_allocations' || cmdType === 'sync_time_earning' || cmdType === 'close_period') {
      var perSh = requireSheet('Періоди балів');
      if (!perSh.ok) return perSh;

      if (cmdType === 'close_period') {
        var cpEmpId = String(cmd.employeeId || '').trim();
        var cpMk = String(cmd.monthKey || '').trim();
        if (!cpEmpId || !cpMk) {
          return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Вкажіть співробітника та місяць періоду.' };
        }
        var closedPeriodRow = {
          'period_id': 'period-' + cpEmpId + '-' + cpMk,
          'employee_id': cpEmpId,
          'month_key': cpMk,
          'base_allocation': Number(cmd.baseAllocation) || 0,
          'debt_carried_in': Number(cmd.debtCarriedIn) || 0,
          'earned_points': Number(cmd.earnedPoints) || 0,
          'deducted_points': Number(cmd.deductedPoints) || 0,
          'spent_points': Number(cmd.spentPoints) || 0,
          'expired_points': Number(cmd.expiredPoints) || 0,
          'status': 'closed',
          'closed_at_utc': nowIso,
          'command_id': String(cmd.commandId || ('close-' + cpEmpId + '-' + cpMk))
        };
        var upClose = upsertCanonicalRows(perSh.sheet, 'period_id', [closedPeriodRow], function(r) { return r; }, ['period_id', 'employee_id', 'month_key']);
        if (!upClose.ok) return upClose;
        appendChangeLogServer_(ss, 'points_period', closedPeriodRow.period_id, 'close', null, closedPeriodRow, 'Закриття періоду ' + cpMk + ' (' + authRes.email + ')', closedPeriodRow.command_id);
        return { ok: true, success: true, message: 'Період ' + cpMk + ' закрито.' };
      }

      var empResAll = readEmployeesResult(ss, null);
      if (!empResAll.ok) return empResAll;
      var activeEmps = empResAll.employees.filter(function(e) { return e.status === 'active'; });
      var generatedTxs = [];

      if (cmdType === 'ensure_monthly_allocations') {
        var targetMk = String(cmd.monthKey || kyivMonthKeyServer_(nowIso));
        for (var ei = 0; ei < activeEmps.length; ei++) {
          var emp = activeEmps[ei];
          var profA = bundle.pointsProfiles.filter(function(p) { return p.employeeId === emp.id; })[0];
          if (profA && profA.pointsEnabled === false) continue;
          var rIdA = (profA && profA.pointsRole === 'manager') ? 'manager' : 'performer';
          var rCfgA = bundle.pointsRoles.filter(function(r) { return r.roleId === rIdA; })[0];
          var basePts = (profA && profA.monthlyBaseOverride !== null && profA.monthlyBaseOverride !== undefined)
            ? Number(profA.monthlyBaseOverride)
            : (rCfgA ? Number(rCfgA.monthlyBasePoints) : (rIdA === 'performer' ? 60 : 0));
          var graceA = rCfgA ? rCfgA.positiveGraceMonths : 1;
          if (!basePts || basePts <= 0) continue;
          var pClosed = bundle.pointsPeriods.some(function(p) { return p.employeeId === emp.id && p.monthKey === targetMk && p.status === 'closed'; });
          if (pClosed) continue;
          var allocCmd = 'monthly_alloc:' + emp.id + ':' + targetMk;
          var already = bundle.pointsTransactions.some(function(t) {
            return t.employeeId === emp.id && t.monthKey === targetMk && (t.operationType === 'monthly_allocation' || t.commandId === allocCmd);
          });
          if (already) continue;
          generatedTxs.push({
            id: 'ptx-alloc-' + emp.id + '-' + targetMk,
            employeeId: emp.id,
            operationType: 'monthly_allocation',
            pointsDelta: basePts,
            reasonId: 'system-monthly-base',
            reasonSnapshot: 'Щомісячна база (' + (rIdA === 'manager' ? 'Керівник' : 'Виконавець') + ')',
            comment: 'Місячне нарахування за ' + targetMk,
            occurredAtUtc: nowIso,
            createdAtUtc: nowIso,
            actorEmployeeId: authRes.email,
            commandId: allocCmd,
            monthKey: targetMk,
            expiresAtUtc: computePositiveExpiryUtcServer_(targetMk, graceA)
          });
        }
      } else {
        // Server-side time_earning sync from Записи
        var allDataRes = gasLoadAllData(spreadsheetInput);
        if (!allDataRes.ok) return allDataRes;
        var allEntries = allDataRes.entries || [];
        var eligibleCatIds = (allDataRes.settings && allDataRes.settings.pointsEligibleCategoryIds) || [];

        for (var ti = 0; ti < activeEmps.length; ti++) {
          var empT = activeEmps[ti];
          var profT = bundle.pointsProfiles.filter(function(p) { return p.employeeId === empT.id; })[0];
          if (profT && profT.pointsEnabled === false) continue;
          var rIdT = (profT && profT.pointsRole === 'manager') ? 'manager' : 'performer';
          var rCfgT = bundle.pointsRoles.filter(function(r) { return r.roleId === rIdT; })[0];
          var timeEnabled = (profT && profT.timeEarningOverride !== null && profT.timeEarningOverride !== undefined)
            ? Boolean(profT.timeEarningOverride)
            : (rCfgT ? Boolean(rCfgT.timeEarningEnabled) : rIdT === 'manager');
          var mpp = (profT && profT.minutesPerPointOverride && profT.minutesPerPointOverride > 0)
            ? Number(profT.minutesPerPointOverride)
            : (rCfgT && rCfgT.minutesPerPoint > 0 ? Number(rCfgT.minutesPerPoint) : 30);
          var eligMode = rCfgT ? rCfgT.eligibleTimeMode : 'all';
          var graceT = rCfgT ? rCfgT.positiveGraceMonths : 1;

          var secsByMk = {};
          for (var eIdx = 0; eIdx < allEntries.length; eIdx++) {
            var ent = allEntries[eIdx];
            if (ent.employeeId !== empT.id) continue;
            var eMk = ent.monthKey || (ent.date ? ent.date.slice(0, 7) : '');
            if (!eMk) continue;
            var mkClosed = bundle.pointsPeriods.some(function(p) { return p.employeeId === empT.id && p.monthKey === eMk && p.status === 'closed'; });
            if (mkClosed) continue;
            if (!timeEnabled) continue;
            if ((eligMode === 'selected_categories' || eligMode === 'eligible_only') && eligibleCatIds.indexOf(ent.categoryId) === -1) continue;
            var eSec = typeof ent.elapsedSeconds === 'number' && ent.elapsedSeconds >= 0 ? Math.round(ent.elapsedSeconds) : Math.round((Number(ent.durationMinutes) || 0) * 60);
            secsByMk[eMk] = (secsByMk[eMk] || 0) + eSec;
          }

          var awardedByMk = {};
          for (var txIdx = 0; txIdx < bundle.pointsTransactions.length; txIdx++) {
            var txE = bundle.pointsTransactions[txIdx];
            if (txE.employeeId !== empT.id) continue;
            if (txE.operationType === 'time_earning' || (txE.operationType === 'reversal' && String(txE.commandId || '').indexOf('time_sync:') === 0)) {
              awardedByMk[txE.monthKey] = (awardedByMk[txE.monthKey] || 0) + (Number(txE.pointsDelta) || 0);
            }
          }

          var mkMap = {};
          Object.keys(secsByMk).forEach(function(k) { mkMap[k] = true; });
          Object.keys(awardedByMk).forEach(function(k) { mkMap[k] = true; });

          Object.keys(mkMap).sort().forEach(function(mkKey) {
            var mkClosed2 = bundle.pointsPeriods.some(function(p) { return p.employeeId === empT.id && p.monthKey === mkKey && p.status === 'closed'; });
            if (mkClosed2) return;
            var totalSec = secsByMk[mkKey] || 0;
            var targetPts = Math.floor(totalSec / (Math.max(1, mpp) * 60));
            var alreadyPts = awardedByMk[mkKey] || 0;
            var diffPts = targetPts - alreadyPts;
            if (diffPts === 0) return;
            var tCmd = 'time_sync:' + empT.id + ':' + mkKey + ':from_' + alreadyPts + '_to_' + targetPts;
            if (bundle.pointsTransactions.some(function(t) { return t.commandId === tCmd; })) return;
            generatedTxs.push({
              id: (diffPts > 0 ? 'ptx-time-' : 'ptx-time-rev-') + empT.id + '-' + mkKey + '-' + targetPts,
              employeeId: empT.id,
              operationType: diffPts > 0 ? 'time_earning' : 'reversal',
              pointsDelta: diffPts,
              reasonId: diffPts > 0 ? 'system-time-earning' : 'system-time-adjustment',
              reasonSnapshot: diffPts > 0 ? ('Нарахування за час (' + Math.round(totalSec / 60) + ' хв)') : ('Корекція балів за час (' + mkKey + ')'),
              comment: 'Синхронізація балів за час (' + mkKey + ')',
              occurredAtUtc: nowIso,
              createdAtUtc: nowIso,
              actorEmployeeId: authRes.email,
              commandId: tCmd,
              monthKey: mkKey,
              expiresAtUtc: diffPts > 0 ? computePositiveExpiryUtcServer_(mkKey, graceT) : ''
            });
          });
        }
      }

      if (generatedTxs.length > 0) {
        var upGen = upsertCanonicalRows(
          txSh.sheet,
          'transaction_id',
          generatedTxs.map(mapTxToCanonicalSheetRowServer_),
          function(r) { return r; },
          ['transaction_id', 'employee_id', 'operation_type', 'points_delta']
        );
        if (!upGen.ok) return upGen;
        appendChangeLogServer_(ss, 'points_sync', cmdType, 'sync', null, { count: generatedTxs.length }, 'Системна синхронізація балів (' + authRes.email + ')', cmd.commandId || '');
      }
      return { ok: true, success: true, transactions: generatedTxs, message: 'Синхронізовано операцій: ' + generatedTxs.length + '.' };
    }

    if (cmdType === 'claim_bonus' || cmdType === 'transition_claim') {
      var claimsSh = requireSheet('Отримані бонуси');
      if (!claimsSh.ok) return claimsSh;
      var claimsRead = readCanonicalSheetObjects(claimsSh.sheet, ['claim_id', 'bonus_id']);
      if (!claimsRead.ok) return claimsRead;
      var existingClaims = (claimsRead.objects || []).map(function(cRow) {
        var stRaw = formatSheetCell(cRow['статус'], 'text').toLowerCase();
        var st = stRaw === 'approved' || stRaw === 'погоджено' ? 'approved'
          : (stRaw === 'fulfilled' || stRaw === 'виконано' ? 'fulfilled'
          : (stRaw === 'cancelled' || stRaw === 'скасовано' ? 'cancelled' : 'requested'));
        var q = Math.max(1, Math.round(Number(cRow['quantity']) || 1));
        var tot = Math.max(0, Number(cRow['вартість_балів']) || 0);
        return {
          id: formatSheetCell(cRow['claim_id'], 'text').trim(),
          bonusId: formatSheetCell(cRow['bonus_id'], 'text').trim(),
          bonusNameSnapshot: formatSheetCell(cRow['назва_на_момент_запиту'], 'text').trim(),
          employeeId: formatSheetCell(cRow['employee_id'], 'text').trim(),
          quantity: q,
          unitPricePoints: cRow['unit_price_points'] !== '' ? Math.max(0, Number(cRow['unit_price_points']) || 0) : Math.round(tot / q),
          totalPointsCost: tot,
          status: st,
          commandId: formatSheetCell(cRow['command_id'], 'text').trim(),
          pointsTransactionId: formatSheetCell(cRow['points_transaction_id'], 'text').trim()
        };
      });

      if (cmdType === 'claim_bonus') {
        var cEmpId = String(cmd.employeeId || '').trim();
        var cBonusId = String(cmd.bonusId || '').trim();
        var cQty = Math.max(1, Math.floor(Number(cmd.quantity) || 1));
        var cCmdId = String(cmd.commandId || '').trim();
        var cComment = String(cmd.comment || '').trim();
        if (!cEmpId || !cBonusId) {
          return { ok: false, success: false, code: 'VALIDATION_ERROR', error: 'Вкажіть співробітника та бонус.' };
        }
        if (cCmdId && existingClaims.some(function(c) { return c.commandId === cCmdId; })) {
          return { ok: true, success: true, idempotent: true, message: 'Запит бонусу вже опрацьовано.' };
        }

        var bonusSheet = ss.getSheetByName('Бонуси');
        if (!bonusSheet) return { ok: false, success: false, code: 'SCHEMA_COMPATIBILITY_BLOCKED', error: 'Аркуш «Бонуси» не знайдено.' };
        var bRead = readCanonicalSheetObjects(bonusSheet, ['id', 'назва', 'ціна_балів']);
        if (!bRead.ok) return bRead;
        var bRow = (bRead.objects || []).filter(function(b) { return formatSheetCell(b['id'], 'text').trim() === cBonusId; })[0];
        if (!bRow || !parseCanonicalBool(bRow['активний'], true)) {
          return { ok: false, success: false, code: 'BONUS_UNAVAILABLE', error: 'Бонус не знайдено або вимкнено.' };
        }

        var cProf = bundle.pointsProfiles.filter(function(p) { return p.employeeId === cEmpId; })[0];
        var cRoleId = (cProf && cProf.pointsRole === 'manager') ? 'manager' : 'performer';
        var cRoleCfg = bundle.pointsRoles.filter(function(r) { return r.roleId === cRoleId; })[0];

        var bRules = bundle.bonusEligibility.filter(function(r) { return r.bonusId === cBonusId; });
        var matchedRule =
          bRules.filter(function(r) { return r.targetType === 'employee' && r.targetId === cEmpId; })[0] ||
          bRules.filter(function(r) { return r.targetType === 'role' && r.targetId === cRoleId; })[0] ||
          bRules.filter(function(r) { return r.targetType === 'all'; })[0] ||
          null;
        if (bRules.length > 0 && (!matchedRule || matchedRule.active === false)) {
          return { ok: false, success: false, code: 'BONUS_FORBIDDEN', error: 'Цей бонус недоступний для обраного співробітника.' };
        }

        var unitPrice = (matchedRule && matchedRule.priceOverride !== null && matchedRule.priceOverride !== undefined)
          ? Math.max(0, Math.round(Number(matchedRule.priceOverride)))
          : Math.max(0, Math.round(Number(bRow['ціна_балів']) || 0));

        if (matchedRule && matchedRule.maxQuantity !== null && matchedRule.maxQuantity !== undefined) {
          var usedQty = existingClaims
            .filter(function(c) { return c.employeeId === cEmpId && c.bonusId === cBonusId && c.status !== 'cancelled'; })
            .reduce(function(s, c) { return s + c.quantity; }, 0);
          if (usedQty + cQty > matchedRule.maxQuantity) {
            return { ok: false, success: false, code: 'BONUS_LIMIT_REACHED', error: 'Перевищено ліміт кількості цього бонусу.' };
          }
        }

        var totalCost = unitPrice * cQty;
        var availPts = computeAvailableBalanceServer_(
          cEmpId,
          bundle.pointsTransactions,
          cRoleCfg ? cRoleCfg.positiveGraceMonths : 1,
          cRoleCfg ? cRoleCfg.negativeCarryover : true
        );
        if (availPts < totalCost) {
          return { ok: false, success: false, code: 'INSUFFICIENT_POINTS', error: 'Недостатньо балів: потрібно ' + totalCost + ', доступно ' + availPts + '.' };
        }

        var bName = formatSheetCell(bRow['назва'], 'text').trim();
        var claimIdNew = 'claim-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        var spendTxId = 'ptx-spend-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        var mkNow = kyivMonthKeyServer_(nowIso);
        var needsAppr = matchedRule ? Boolean(matchedRule.requiresApproval) : false;
        var initStatus = needsAppr ? 'requested' : 'approved';

        var spendTx = {
          id: spendTxId,
          employeeId: cEmpId,
          operationType: 'reward_spend',
          pointsDelta: -totalCost,
          reasonId: 'bonus:' + cBonusId,
          reasonSnapshot: 'Бонус: ' + bName + ' (×' + cQty + ')',
          comment: cComment || ('Запит бонусу «' + bName + '» ×' + cQty),
          occurredAtUtc: nowIso,
          createdAtUtc: nowIso,
          actorEmployeeId: authRes.email,
          commandId: cCmdId || ('cmd-' + claimIdNew),
          monthKey: mkNow,
          expiresAtUtc: ''
        };

        var upSpend = upsertCanonicalRows(txSh.sheet, 'transaction_id', [mapTxToCanonicalSheetRowServer_(spendTx)], function(r) { return r; }, ['transaction_id', 'employee_id', 'operation_type', 'points_delta']);
        if (!upSpend.ok) return upSpend;

        var claimRow = {
          'claim_id': claimIdNew,
          'bonus_id': cBonusId,
          'назва_на_момент_запиту': bName,
          'employee_id': cEmpId,
          'quantity': cQty,
          'unit_price_points': unitPrice,
          'вартість_балів': totalCost,
          'дата_запиту_utc': nowIso,
          'статус': initStatus,
          'дата_отримання_utc': '',
          'коментар': cComment,
          'command_id': cCmdId || ('cmd-' + claimIdNew),
          'updated_at_utc': nowIso,
          'approved_by_employee_id': initStatus === 'approved' ? 'system-auto' : '',
          'approved_at_utc': initStatus === 'approved' ? nowIso : '',
          'points_transaction_id': spendTxId,
          'eligibility_id': matchedRule ? matchedRule.id : ''
        };

        var upClaim = upsertCanonicalRows(claimsSh.sheet, 'claim_id', [claimRow], function(r) { return r; }, ['claim_id', 'bonus_id']);
        if (!upClaim.ok) return upClaim;
        appendChangeLogServer_(ss, 'bonus_claim', claimIdNew, 'create', null, claimRow, 'Отримання бонусу (' + authRes.email + ')', claimRow.command_id);
        return { ok: true, success: true, claim: claimRow, spendTransaction: spendTx, message: 'Запит на отримання бонусу збережено.' };
      }

      if (cmdType === 'transition_claim') {
        var tClaimId = String(cmd.claimId || '').trim();
        var nextSt = String(cmd.nextStatus || '').trim();
        var tComment = String(cmd.comment || '').trim();
        var targetClaim = existingClaims.filter(function(c) { return c.id === tClaimId; })[0];
        if (!targetClaim) {
          return { ok: false, success: false, code: 'NOT_FOUND', error: 'Запит на бонус не знайдено.' };
        }
        if (targetClaim.status === 'cancelled') {
          return { ok: false, success: false, code: 'INVALID_STATUS', error: 'Запит уже скасовано.' };
        }
        if (nextSt === 'cancelled') {
          var refundCmdId = 'refund_claim:' + targetClaim.id;
          var hasRefund = bundle.pointsTransactions.some(function(t) {
            return t.operationType === 'reward_refund' && (t.commandId === refundCmdId || (targetClaim.pointsTransactionId && t.reversalOfTransactionId === targetClaim.pointsTransactionId));
          });
          if (!hasRefund && targetClaim.totalPointsCost > 0) {
            var refundTx = {
              id: 'ptx-refund-' + targetClaim.id + '-' + Date.now(),
              employeeId: targetClaim.employeeId,
              operationType: 'reward_refund',
              pointsDelta: targetClaim.totalPointsCost,
              reasonId: 'bonus:' + targetClaim.bonusId,
              reasonSnapshot: 'Повернення за скасований бонус: ' + targetClaim.bonusNameSnapshot,
              comment: tComment || ('Скасування запиту ' + targetClaim.id),
              occurredAtUtc: nowIso,
              createdAtUtc: nowIso,
              actorEmployeeId: authRes.email,
              commandId: refundCmdId,
              reversalOfTransactionId: targetClaim.pointsTransactionId || '',
              monthKey: kyivMonthKeyServer_(nowIso),
              expiresAtUtc: ''
            };
            var upRef = upsertCanonicalRows(txSh.sheet, 'transaction_id', [mapTxToCanonicalSheetRowServer_(refundTx)], function(r) { return r; }, ['transaction_id', 'employee_id', 'operation_type', 'points_delta']);
            if (!upRef.ok) return upRef;
          }
        }
        var updateClaimRow = {
          'claim_id': targetClaim.id,
          'bonus_id': targetClaim.bonusId,
          'статус': nextSt,
          'updated_at_utc': nowIso
        };
        if (nextSt === 'approved') {
          updateClaimRow['approved_by_employee_id'] = authRes.email;
          updateClaimRow['approved_at_utc'] = nowIso;
        }
        if (nextSt === 'fulfilled') {
          updateClaimRow['дата_отримання_utc'] = nowIso;
        }
        var upClaimSt = upsertCanonicalRows(claimsSh.sheet, 'claim_id', [updateClaimRow], function(r) { return r; }, ['claim_id', 'bonus_id']);
        if (!upClaimSt.ok) return upClaimSt;
        appendChangeLogServer_(ss, 'bonus_claim', targetClaim.id, 'status_' + nextSt, targetClaim, updateClaimRow, tComment || ('Зміна статусу на ' + nextSt), String(cmd.commandId || ''));
        return { ok: true, success: true, message: 'Статус бонусу оновлено.' };
      }
    }

    return { ok: false, success: false, code: 'UNKNOWN_POINTS_COMMAND', error: 'Непідтримувана команда системи балів.' };
  }, spreadsheetInput);
}
