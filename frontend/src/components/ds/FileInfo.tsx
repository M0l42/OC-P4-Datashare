import { FileIcon } from '../icons'
import styles from './FileInfo.module.css'

interface FileInfoProps {
  name: string
  size: string
}

// File icon + name, with size on its own line below — the file header
// repeated on both the upload and download screens in every mockup.
export function FileInfo({ name, size }: FileInfoProps) {
  return (
    <div className={styles.row}>
      <span className={styles.icon}>
        <FileIcon />
      </span>
      <div className={styles.text}>
        <p className={styles.name}>{name}</p>
        <p className={styles.size}>{size}</p>
      </div>
    </div>
  )
}
