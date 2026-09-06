import { useId, type InputHTMLAttributes } from 'react'
import styles from './Field.module.css'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  description?: string
  error?: string
}

export function Input({ label, description, error, className, ...rest }: InputProps) {
  const id = useId()
  const describedBy = [description ? `${id}-desc` : '', error ? `${id}-err` : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {description && (
        <span className={styles.description} id={`${id}-desc`}>
          {description}
        </span>
      )}
      <input
        id={id}
        className={`${styles.control} ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {error && (
        <span className={styles.error} id={`${id}-err`}>
          {error}
        </span>
      )}
    </div>
  )
}
