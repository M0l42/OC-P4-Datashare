export const SCAN_QUEUE_NAME = 'file-validation';

// Plafond ClamAV. Au-delà, l'objet n'est jamais entièrement retiré de MinIO :
// la limite de flux par défaut de clamd est très inférieure à 1 Go, et une
// lecture complète casserait la propriété « l'API ne touche jamais les
// octets » à la frontière du worker. Limite assumée, documentée dans
// SECURITY.md, pas un oubli.
export const CLAMAV_MAX_SCAN_BYTES = 50 * 1024 * 1024;

// Une signature de fichier tient dans les premiers octets. 64 suffit
// largement pour toutes les signatures du tableau ci-dessous.
export const MAGIC_BYTES_RANGE_END = 63;

// Une ligne bloquée en `scanning` au-delà de ce délai signifie un worker mort
// en cours de job : elle est remise en file. C'est la raison pour laquelle le
// worker POSE `scanning` au démarrage du job au lieu de simplement lire.
export const SCANNING_STALE_AFTER_MS = 15 * 60 * 1000;
export const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
