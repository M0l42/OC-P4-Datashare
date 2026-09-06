// US10 : constantes documentées dans MAINTENANCE.md.
export const PURGE_QUEUE_NAME = 'file-purge';

// Un seul job planifié, déduplication par jobSchedulerId : redémarrer le
// worker ne crée pas un second planning, BullMQ reconnaît le même id.
export const PURGE_SWEEP_JOB_ID = 'daily-sweep';
export const PURGE_SWEEP_CRON = '0 3 * * *'; // tous les jours à 03:00

// Fenêtre de rétention des lignes fantômes (`expired`/`rejected`) : la trace
// vit exactement aussi longtemps que le fichier a vécu chez nous.
export const GHOST_ROW_TTL_DAYS = 7;

// Fenêtre du reaper. US01-R (reprise d'upload) dépend de cette valeur :
// au-delà, ListParts renvoie NoSuchUpload et la reprise doit être refusée
// explicitement plutôt que d'échouer sans explication.
export const ABANDONED_UPLOAD_TTL_HOURS = 48;
