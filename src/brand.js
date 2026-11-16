// v0.2.4: the app's user-facing name. The repo, the Pages URL, every shopsmartr:* storage key, the
// feed files and the backup/encryption format ids keep the old "shopsmartr" name so nobody loses data.
export const APP_NAME = 'Happy Wife Helper';
/** Under the home-screen icon (fits on iOS without "…"). */
export const SHORT_NAME = 'Happy Wife';
export const MADE_BY = 'Made by Steven Moran';
export const REPO_URL = 'https://github.com/tommyjarvis-a/shopsmartr';
export const LIVE_URL = 'https://tommyjarvis-a.github.io/shopsmartr/';
/** File-name stem for downloads: happy-wife-helper-backup-2026-11-15.json */
export const FILE_STEM = 'happy-wife-helper';

/** True when running as an installed home-screen app (iOS navigator.standalone or display-mode). */
export function isStandalone(win = globalThis) {
  try {
    if (win.navigator?.standalone === true) return true;
    return Boolean(win.matchMedia?.('(display-mode: standalone)').matches);
  } catch { return false; }
}
