import { useId, type SelectHTMLAttributes } from 'react'
import styles from './Field.module.css'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  description?: string
  options: SelectOption[]
}

// Native <select> on purpose. The mockups draw a custom options panel, but
// rebuilding one would trade away keyboard support, screen-reader behaviour
// and the native mobile picker for a visual gain on a single field.
export function Select({ label, description, options, className, ...rest }: SelectProps) {
  const id = useId()

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
      <select
        id={id}
        className={`${styles.control} ${className ?? ''}`}
        aria-describedby={description ? `${id}-desc` : undefined}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
