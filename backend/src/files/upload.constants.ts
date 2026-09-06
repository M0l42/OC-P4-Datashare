// US01 : plafond de taille et liste noire d'extensions, tranchés en revue et
// documentés dans docs/design-decisions.md (règles de validation).
export const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 Gio
export const PART_SIZE_BYTES = 8 * 1024 * 1024; // 8 Mio, doit correspondre au défaut Prisma (part_size)
export const MAX_TAG_LENGTH = 30;
export const MIN_DOWNLOAD_PASSWORD_LENGTH = 6;
export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 7;

export const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'ps1',
  'vbs',
  'js',
  'jar',
  'sh',
  'dll',
  'app',
  'docm',
  'xlsm',
  'pptm',
  'iso',
  'lnk',
]);

export function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? '' : fileName.slice(lastDot + 1).toLowerCase();
}
