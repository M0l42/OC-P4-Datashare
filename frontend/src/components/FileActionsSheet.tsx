import { useEffect } from 'react'
import { Button } from './ds'
import { ArrowRightIcon, TrashIcon } from './icons'
import styles from './FileActionsSheet.module.css'

interface FileActionsSheetProps {
  fileName: string
  /** Omitted for expired/rejected rows — there's nothing left to open. */
  onAccess?: () => void
  onDelete: () => void
  onClose: () => void
}

// Mobile stand-in for the desktop row's inline buttons: a sheet sliding up
// from the bottom instead of a dropdown, so the actions stay full width and
// thumb-reachable. No mockup covers this state — it doesn't exist at either
// breakpoint — so the layout here is original.
export function FileActionsSheet({ fileName, onAccess, onDelete, onClose }: FileActionsSheetProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions pour ${fileName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.handle} aria-hidden="true" />
        <p className={styles.fileName}>{fileName}</p>
        {onAccess && (
          <Button variant="secondary" fullWidth icon={<ArrowRightIcon />} onClick={onAccess}>
            Accéder
          </Button>
        )}
        <Button variant="secondary" fullWidth icon={<TrashIcon />} onClick={onDelete}>
          Supprimer
        </Button>
      </div>
    </div>
  )
}
