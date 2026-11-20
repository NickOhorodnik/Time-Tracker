import { isGasHostedRuntime } from '../services/gasBridge';
import { normalizeDriveImageUrl } from './imageUrlValidator';

export interface GasAssetManifestEntry {
  filename: string;
  path: string;
  encodedPath?: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  partial: string;
}

declare global {
  interface Window {
    __ALLONSY_GAS_ASSETS__?: Record<string, string>;
    __ALLONSY_GAS_ASSET_MANIFEST__?: GasAssetManifestEntry[];
  }
}

const DELETED_BUNDLED_ASSET_RE =
  /\/assets\/aistudio\/image_(9fc3a324|b0f4189a|c6e62f7c|cc8d6bdd|1219077b|56d1ee62|2f7b48dc)\.png$/i;

export function isStaleLocalAssetPath(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return DELETED_BUNDLED_ASSET_RE.test(url.trim());
}

/**
 * Resolves image URLs cleanly across runtimes without silently substituting missing local assets:
 * - Converts Google Drive sharing URLs / IDs into usable direct HTTPS thumbnail URLs.
 * - Keeps HTTPS, HTTP, blob:, and data: URLs intact.
 * - Returns '' for empty or deleted local placeholder paths.
 */
export function resolveAssetUrl(url?: string | null): string {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw || raw === '[локальне зображення]' || isStaleLocalAssetPath(raw)) {
    return '';
  }

  const normalizedRemote = normalizeDriveImageUrl(raw);
  if (
    normalizedRemote.startsWith('data:') ||
    normalizedRemote.startsWith('blob:') ||
    normalizedRemote.startsWith('http://') ||
    normalizedRemote.startsWith('https://')
  ) {
    return normalizedRemote;
  }

  if (!isGasHostedRuntime() || typeof window === 'undefined') {
    return raw;
  }

  const assetMap = window.__ALLONSY_GAS_ASSETS__;
  if (!assetMap) {
    return raw;
  }

  const normalizedLeading = raw.startsWith('/') ? raw : `/${raw}`;
  let decoded = normalizedLeading;
  try {
    decoded = decodeURI(normalizedLeading);
  } catch {
    decoded = normalizedLeading;
  }

  return assetMap[raw] || assetMap[normalizedLeading] || assetMap[decoded] || '';
}

export function getGasAssetManifest(): GasAssetManifestEntry[] {
  if (typeof window === 'undefined') return [];
  return Array.isArray(window.__ALLONSY_GAS_ASSET_MANIFEST__)
    ? window.__ALLONSY_GAS_ASSET_MANIFEST__
    : [];
}
