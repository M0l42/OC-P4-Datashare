export type ExpiryTone = 'info' | 'alert' | 'error'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

// DESIGN.md : « Info (expirera dans 3 jours) → Alert (expirera demain) →
// Error (a expiré) ». Fonction unique, partagée entre la page destinataire,
// les lignes de Mon espace et l'écran de succès de l'expéditeur (ces deux
// derniers pas encore construits).
export function expiryTone(expiresAt: string | Date): ExpiryTone {
  const msRemaining = new Date(expiresAt).getTime() - Date.now()
  if (msRemaining <= 0) return 'error'
  if (msRemaining <= ONE_DAY_MS) return 'alert'
  return 'info'
}
