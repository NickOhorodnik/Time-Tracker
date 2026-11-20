import { SyncState } from '../types';

export type SyncDiagnosticKind =
  | 'preview_disabled'
  | 'loading'
  | 'schema_error'
  | 'gas_unavailable'
  | 'empty_sheet'
  | 'all_inactive'
  | 'invalid_media_url'
  | 'ok';

export interface SyncStatusMessage {
  kind: SyncDiagnosticKind;
  title: string;
  description: string;
}

function isSchemaErrorCode(code?: string | null): boolean {
  return code === 'SCHEMA_COMPATIBILITY_BLOCKED' || code === 'SHEET_NOT_FOUND';
}

export function getPhrasesStatusMessage(
  syncState: SyncState | undefined,
  totalCount: number,
  activeCount: number,
  datasetLabel: 'Фрази' | 'Мотиваційні фрази'
): SyncStatusMessage {
  const isMotivation = datasetLabel === 'Мотиваційні фрази';
  const sheetName = datasetLabel;

  if (syncState?.runtimeMode === 'local_preview' || syncState?.status === 'local_preview') {
    if (activeCount === 0) {
      return {
        kind: 'preview_disabled',
        title: isMotivation
          ? 'Локальний режим Preview (віддалену синхронізацію вимкнено)'
          : 'Фрази з Google Таблиці недоступні в AI Studio Preview',
        description:
          `У режимі AI Studio Preview дані з аркуша «${sheetName}» не завантажуються. Додайте записи локально або відкрийте розгорнуту веб-програму Google Apps Script.`,
      };
    }
    return {
      kind: 'ok',
      title: '',
      description: '',
    };
  }

  if (syncState?.status === 'unverified') {
    return {
      kind: 'loading',
      title: `Завантаження аркуша «${sheetName}»...`,
      description: 'Триває зчитування рядків із прив’язаної Google Таблиці через Google Apps Script.',
    };
  }

  if (syncState?.status === 'error') {
    if (isSchemaErrorCode(syncState.errorCode)) {
      return {
        kind: 'schema_error',
        title: `Невірна структура аркуша «${sheetName}»`,
        description:
          syncState.errorMessage ||
          `Аркуш «${sheetName}» відсутній або не містить очікуваних заголовків.`,
      };
    }
    if (
      syncState.errorCode === 'SPREADSHEET_URL_REQUIRED' ||
      syncState.errorCode === 'SPREADSHEET_URL_INVALID'
    ) {
      return {
        kind: 'gas_unavailable',
        title: 'Додайте посилання на власну Google Таблицю',
        description:
          syncState.errorMessage ||
          'Додайте посилання на власну Google Таблицю в налаштуваннях додатка.',
      };
    }
    return {
      kind: 'gas_unavailable',
      title: 'Google Apps Script або таблиця недоступні',
      description:
        syncState.errorMessage ||
        `Не вдалося завантажити дані з аркуша «${sheetName}». Перевірте прив’язку таблиці та дозволи веб-програми.`,
    };
  }

  if (totalCount === 0) {
    return {
      kind: 'empty_sheet',
      title: `Аркуш «${sheetName}» порожній`,
      description: isMotivation
        ? 'У Google Таблиці на аркуші «Мотиваційні фрази» ще немає жодного рядка. Додайте шаблон із {hours} або {earned}.'
        : 'У Google Таблиці на аркуші «Фрази» поки немає рядків. Додайте репліки в таблиці або в Налаштуваннях.',
    };
  }

  if (activeCount === 0) {
    return {
      kind: 'all_inactive',
      title: `Усі рядки на аркуші «${sheetName}» вимкнено`,
      description: isMotivation
        ? `Знайдено ${totalCount} шаблонів, але всі вони мають active = FALSE.`
        : `Знайдено ${totalCount} фраз, але всі вони мають активна = FALSE.`,
    };
  }

  return {
    kind: 'ok',
    title: '',
    description: '',
  };
}

export function getCharacterImageStatusMessage(
  syncState: SyncState | undefined,
  stageNumber: number,
  isBrokenRuntimeImage: boolean,
  currentImageUrl?: string
): SyncStatusMessage {
  if (isBrokenRuntimeImage) {
    return {
      kind: 'invalid_media_url',
      title: 'Не вдалося завантажити зображення Cloudinary / HTTPS',
      description: currentImageUrl
        ? `Посилання не відповідає або повернуло помилку: ${currentImageUrl}`
        : 'Перевірте URL у стовпці file_reference або image_url аркуша «Бібліотека зображень».',
    };
  }

  const diagnostics = syncState?.imageDiagnostics;
  if (diagnostics) {
    const stageIssue = diagnostics.unresolvedAssignments.find((item) => item.stage === stageNumber);
    if (stageIssue) {
      return {
        kind: 'invalid_media_url',
        title:
          stageIssue.reason === 'invalid_url'
            ? `Некоректний URL зображення (Етап ${stageNumber})`
            : stageIssue.reason === 'missing_url'
            ? `Відсутній URL Cloudinary (Етап ${stageNumber})`
            : stageIssue.reason === 'inactive_asset'
            ? `Актив етапу ${stageNumber} вимкнено`
            : `Актив етапу ${stageNumber} не знайдено`,
        description: stageIssue.message,
      };
    }

    if (diagnostics.invalidUrlAssets.length > 0 && diagnostics.usableUrlCount === 0) {
      const firstIssue = diagnostics.invalidUrlAssets[0];
      return {
        kind: 'invalid_media_url',
        title: 'Некоректні посилання в «Бібліотеці зображень»',
        description: firstIssue.message,
      };
    }
  }

  if (syncState?.runtimeMode === 'local_preview' || syncState?.status === 'local_preview') {
    return {
      kind: 'preview_disabled',
      title: 'Зображення з Google Таблиці не синхронізовано (AI Studio Preview)',
      description:
        'У локальному режимі Preview віддалене читання Google Таблиці вимкнено. Відкрийте веб-програму Google Apps Script або додайте URL у «Бібліотеці зображень».',
    };
  }

  if (syncState?.status === 'unverified') {
    return {
      kind: 'loading',
      title: 'Завантаження зображень із таблиці...',
      description: 'Зчитуємо «Бібліотеку зображень» та «Призначення зображень».',
    };
  }

  if (syncState?.status === 'error') {
    if (isSchemaErrorCode(syncState.errorCode)) {
      return {
        kind: 'schema_error',
        title: 'Помилка заголовків або аркушів зображень',
        description:
          syncState.errorMessage ||
          'Перевірте наявність аркушів «Бібліотека зображень» та «Призначення зображень» і канонічні заголовки.',
      };
    }
    if (
      syncState.errorCode === 'SPREADSHEET_URL_REQUIRED' ||
      syncState.errorCode === 'SPREADSHEET_URL_INVALID'
    ) {
      return {
        kind: 'gas_unavailable',
        title: 'Додайте посилання на власну Google Таблицю',
        description:
          syncState.errorMessage ||
          'Перевірте посилання на таблицю в налаштуваннях і доступ скрипту до неї.',
      };
    }
    return {
      kind: 'gas_unavailable',
      title: 'GAS або таблиця недоступні',
      description:
        syncState.errorMessage ||
        'Не вдалося підключитися до Google Apps Script для читання зображень.',
    };
  }

  if (diagnostics && diagnostics.totalAssets === 0) {
    return {
      kind: 'empty_sheet',
      title: 'Аркуш «Бібліотека зображень» порожній',
      description:
        'Додайте Cloudinary HTTPS URL у стовпець file_reference та призначте слоти на аркуші «Призначення зображень».',
    };
  }

  return {
    kind: 'empty_sheet',
    title: 'Зображення для етапу не призначено',
    description:
      'Перевірте file_reference / image_url у «Бібліотеці зображень» та активне призначення для stage_01..stage_05 у «Призначенні зображень».',
  };
}
