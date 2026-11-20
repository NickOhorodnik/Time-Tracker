export interface ReadOnlyShareConfig {
  isReadOnly: boolean;
  hasShareParam: boolean;
  spreadsheetInput: string;
  spreadsheetId: string;
  gasUrl: string;
  sourceMode: 'gas' | 'public_sheet';
  error: string | null;
}

const SPREADSHEET_PARAM_KEYS = new Set([
  'sheet',
  'sheeturl',
  'spreadsheet',
  'spreadsheeturl',
  'spreadsheetinput',
  'spreadsheetid',
  'sheetid',
  'url',
]);

const GAS_PARAM_KEYS = new Set(['gas', 'gasurl', 'gaswebappurl']);

export function extractSpreadsheetIdFromUrlOrId(rawInput: unknown): string {
  const raw = String(rawInput || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,120})/);
  const candidate = match ? match[1] : raw;
  return /^[a-zA-Z0-9_-]{10,120}$/.test(candidate) ? candidate : '';
}

export function normalizeShareGasUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'script.google.com' ||
      !/^\/macros\/(?:u\/\d+\/)?s\/[^/]+\/exec\/?$/.test(url.pathname)
    ) {
      return '';
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function collectParamsCaseInsensitive(rawSearch: string, rawHash: string): Map<string, string> {
  const map = new Map<string, string>();
  const addFromSearchParams = (qs: string) => {
    const cleaned = qs.replace(/^[?#]+/, '');
    if (!cleaned) return;
    // Support bare spreadsheet URL right after '?' e.g. ?https://docs.google.com/spreadsheets/d/...
    if (/^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(cleaned)) {
      map.set('sheet', decodeURIComponent(cleaned));
      return;
    }
    const params = new URLSearchParams(cleaned);
    params.forEach((value, key) => {
      const normalizedKey = key.trim().toLowerCase();
      if (!normalizedKey) return;
      if (!value && /^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(key.trim())) {
        map.set('sheet', key.trim());
        return;
      }
      if (value.trim()) {
        map.set(normalizedKey, value.trim());
      } else if (!map.has(normalizedKey)) {
        map.set(normalizedKey, '');
      }
    });
  };

  addFromSearchParams(rawSearch);
  if (rawHash && rawHash.includes('=')) {
    const hashQuery = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : rawHash;
    addFromSearchParams(hashQuery);
  }
  return map;
}

export function parseReadOnlyShareLink(
  search?: string,
  hash?: string
): ReadOnlyShareConfig | null {
  const rawSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined' && window.location
      ? window.location.search
      : '';
  const rawHash =
    hash !== undefined
      ? hash
      : typeof window !== 'undefined' && window.location
      ? window.location.hash
      : '';

  if (!rawSearch && !rawHash) return null;

  const params = collectParamsCaseInsensitive(rawSearch, rawHash);

  let rawSheetInput = '';
  let foundSheetParam = false;
  for (const key of SPREADSHEET_PARAM_KEYS) {
    if (params.has(key)) {
      foundSheetParam = true;
      const val = params.get(key) || '';
      if (val) {
        rawSheetInput = val;
        break;
      }
    }
  }

  let rawGasInput = '';
  for (const key of GAS_PARAM_KEYS) {
    const val = params.get(key) || '';
    if (val) {
      rawGasInput = val;
      break;
    }
  }

  const readonlyFlag =
    params.get('readonly') === '1' ||
    params.get('readonly') === 'true' ||
    params.get('view') === 'readonly' ||
    params.get('mode') === 'readonly';

  if (!foundSheetParam && !readonlyFlag) {
    return null;
  }

  const spreadsheetId = extractSpreadsheetIdFromUrlOrId(rawSheetInput);
  const gasUrl = normalizeShareGasUrl(rawGasInput);

  if (!spreadsheetId) {
    return {
      isReadOnly: true,
      hasShareParam: true,
      spreadsheetInput: rawSheetInput,
      spreadsheetId: '',
      gasUrl,
      sourceMode: gasUrl ? 'gas' : 'public_sheet',
      error:
        'У посиланні для перегляду вказано некоректний або порожній URL Google Таблиці.',
    };
  }

  if (rawGasInput && !gasUrl) {
    return {
      isReadOnly: true,
      hasShareParam: true,
      spreadsheetInput: rawSheetInput,
      spreadsheetId,
      gasUrl: '',
      sourceMode: 'public_sheet',
      error:
        'Параметр Apps Script (?gas=...) у посиланні має некоректний формат URL (/exec).',
    };
  }

  return {
    isReadOnly: true,
    hasShareParam: true,
    spreadsheetInput: rawSheetInput,
    spreadsheetId,
    gasUrl,
    sourceMode: gasUrl ? 'gas' : 'public_sheet',
    error: null,
  };
}

export function buildReadOnlyShareUrl(
  baseHref: string,
  spreadsheetInputOrId: string,
  gasWebAppUrl?: string
): string {
  const url = new URL(baseHref);
  url.search = '';
  url.hash = '';
  const cleanSheet = String(spreadsheetInputOrId || '').trim();
  const sheetId = extractSpreadsheetIdFromUrlOrId(cleanSheet);
  const normalizedSheetUrl = sheetId
    ? cleanSheet.startsWith('http')
      ? cleanSheet
      : `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
    : '';
  if (normalizedSheetUrl) {
    url.searchParams.set('sheet', normalizedSheetUrl);
  }
  const normalizedGas = normalizeShareGasUrl(gasWebAppUrl);
  if (normalizedGas) {
    url.searchParams.set('gas', normalizedGas);
  }
  return url.toString();
}
