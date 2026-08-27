import { useEffect, useState } from 'react'
import { Button, Callout, FileInfo } from './ds'
import styles from './ConfirmDeleteDialog.module.css'

interface ConfirmDeleteDialogProps {
  fileName: string
  fileSize: string
  /** Owns the actual DELETE call (see lib/files.ts#deleteFile) and whatever
   * list refresh follows it. Rejecting shows the inline error below. */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

// The confirmation step US06 requires before a file disappears — not one of
// the six design-system primitives (DESIGN.md), so it composes Button and
// Callout rather than inventing a new one. No mockup covers this state; the
// layout here is original, copy follows the product's plain, no-pronoun
// register used elsewhere for irreversible actions.
export function ConfirmDeleteDialog({ fileName, fileSize, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleting, onCancel])

  async function handleConfirm() {
    setDeleting(true)
    setError(null)
    try {
      await onConfirm()
    } catch {
      setError('La suppression a échoué. Réessayez.')
      setDeleting(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={deleting ? undefined : onCancel}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className={styles.title}>
          Supprimer ce fichier ?
        </h2>
        <FileInfo name={fileName} size={fileSize} />
        <Callout variant="alert">
          Suppression définitive : le fichier et son lien de téléchargement cessent d'exister immédiatement, sans
          retour possible.
        </Callout>
        {error && <Callout variant="error">{error}</Callout>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={deleting}>
            Annuler
          </Button>
          <Button variant="dark" onClick={() => void handleConfirm()} disabled={deleting}>
            {deleting ? 'Suppression…' : 'Supprimer'}
          </Button>
        </div>
      </div>
    </div>
  )
}
