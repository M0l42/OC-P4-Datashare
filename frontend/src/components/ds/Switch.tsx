import styles from './Switch.module.css'

export interface SwitchOption<T extends string> {
  value: T
  label: string
}

interface SwitchProps<T extends string> {
  options: SwitchOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Describes what the filter controls, for assistive tech. */
  label: string
}

// Generic over its options rather than hardwired: DESIGN.md describes a
// two-option filter but the mockups draw three, and the mockups win.
//
// tablist over a radio group — these segments switch a view, they don't
// capture a form value.
export function Switch<T extends string>({ options, value, onChange, label }: SwitchProps<T>) {
  return (
    <div className={styles.switch} role="tablist" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`${styles.option} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
