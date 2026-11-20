/**
 * Image URL Validator for Allonsy Centralized Image Library
 *
 * Rules:
 * - HTTPS only for new persistent URLs (no plain HTTP, ftp, data: URLs).
 * - Do NOT require file extensions (e.g. .png, .jpg are optional; CDN, Unsplash, Imgur, Cloudinary, query params allowed).
 * - Detect Google Drive sharing-page URLs (drive.google.com/file/d/.../view) and warn the user
 *   with an explicit explanation that Drive sharing pages are not direct image sources.
 */

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  error?: string;
  warning?: string;
  isDriveSharingUrl: boolean;
}

const DRIVE_SHARING_PATTERNS = [
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/(view|edit)/i,
  /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i,
  /docs\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
];

export function extractDriveFileId(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Bare Google Drive file ID
  if (/^[a-zA-Z0-9_-]{15,80}$/.test(trimmed)) {
    return trimmed;
  }

  const filePathMatch = /\/file\/d\/([a-zA-Z0-9_-]{10,})/i.exec(trimmed);
  if (filePathMatch && filePathMatch[1]) {
    return filePathMatch[1];
  }

  const isGoogleDriveHost = /https?:\/\/(drive|docs)\.google\.com\//i.test(trimmed);
  if (isGoogleDriveHost) {
    const idParamMatch = /[?&]id=([a-zA-Z0-9_-]{10,})/i.exec(trimmed);
    if (idParamMatch && idParamMatch[1]) {
      return idParamMatch[1];
    }
  }

  const lh3Match = /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/i.exec(trimmed);
  if (lh3Match && lh3Match[1]) {
    return lh3Match[1];
  }

  return '';
}

export function toDriveThumbnailUrl(fileId: string): string {
  const cleanId = fileId.trim();
  if (!cleanId) return '';
  return `https://drive.google.com/thumbnail?id=${cleanId}&sz=w1000`;
}

/**
 * Normalizes protocol-relative or http Cloudinary URLs to direct https:// URLs.
 */
export function normalizeCloudinaryAndExternalUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const candidate = rawUrl.trim();
  if (!candidate || candidate === '[локальне зображення]') return '';

  if (/^\/\/res\.cloudinary\.com\//i.test(candidate)) {
    return `https:${candidate}`;
  }
  if (/^http:\/\/res\.cloudinary\.com\//i.test(candidate)) {
    return candidate.replace(/^http:\/\//i, 'https://');
  }
  if (/^res\.cloudinary\.com\//i.test(candidate)) {
    return `https://${candidate}`;
  }
  return candidate;
}

export function isValidRemoteImageUrl(rawUrl?: string | null): boolean {
  const candidate = normalizeCloudinaryAndExternalUrl(rawUrl);
  if (!candidate) return false;
  if (!/^https?:\/\//i.test(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return Boolean(parsed.hostname && (parsed.hostname.includes('.') || parsed.hostname === 'localhost'));
  } catch {
    return false;
  }
}

/**
 * Converts Google Drive sharing/open/uc URLs or bare Drive file IDs into a directly
 * renderable HTTPS image URL, while normalizing Cloudinary URLs and preserving data/blob URLs.
 */
export function normalizeDriveImageUrl(
  rawUrl?: string | null,
  fallbackDriveFileId?: string | null
): string {
  const candidate = normalizeCloudinaryAndExternalUrl(rawUrl);
  const driveIdInput = typeof fallbackDriveFileId === 'string' ? fallbackDriveFileId.trim() : '';

  if (candidate && candidate !== '[локальне зображення]') {
    if (/https?:\/\/(drive|docs)\.google\.com\//i.test(candidate)) {
      const extracted = extractDriveFileId(candidate) || extractDriveFileId(driveIdInput);
      if (extracted) {
        return toDriveThumbnailUrl(extracted);
      }
    }

    if (
      candidate.startsWith('https://') ||
      candidate.startsWith('http://') ||
      candidate.startsWith('data:') ||
      candidate.startsWith('blob:')
    ) {
      return candidate;
    }

    if (!candidate.includes('/') && !candidate.includes('.')) {
      const bareId = extractDriveFileId(candidate);
      if (bareId) {
        return toDriveThumbnailUrl(bareId);
      }
    }

    return candidate;
  }

  if (driveIdInput) {
    const cleanId = extractDriveFileId(driveIdInput) || driveIdInput;
    if (cleanId) {
      return toDriveThumbnailUrl(cleanId);
    }
  }

  return '';
}

export function isGoogleDriveSharingUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return DRIVE_SHARING_PATTERNS.some((pattern) => pattern.test(url.trim()));
}

export function validateImageUrl(input?: string | null): UrlValidationResult {
  if (!input || typeof input !== 'string') {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Вкажіть посилання на зображення.',
      isDriveSharingUrl: false,
    };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Посилання на зображення не може бути порожнім.',
      isDriveSharingUrl: false,
    };
  }

  // Reject insecure or non-HTTPS protocols
  if (!trimmed.toLowerCase().startsWith('https://')) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: 'Дозволені лише захищені посилання, які починаються з https:// (http:// або локальні шляхи не підтримуються).',
      isDriveSharingUrl: false,
    };
  }

  // Validate structural URL syntax
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: 'Некоректний формат URL. Перевірте правильність написання адреси.',
      isDriveSharingUrl: false,
    };
  }

  if (parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: 'Протокол має бути виключно https://',
      isDriveSharingUrl: false,
    };
  }

  // Check for Google Drive sharing-page URLs
  const isDriveSharing = isGoogleDriveSharingUrl(trimmed);
  const resolvedUrl = normalizeDriveImageUrl(trimmed) || trimmed;
  let warning: string | undefined;

  if (isDriveSharing) {
    warning =
      'Посилання Google Drive автоматично перетворено на пряме зображення (thumbnail). Переконайтеся, що у файлі відкрито доступ «Усі, хто має посилання».';
  }

  return {
    valid: true,
    normalizedUrl: resolvedUrl,
    warning,
    isDriveSharingUrl: isDriveSharing,
  };
}
