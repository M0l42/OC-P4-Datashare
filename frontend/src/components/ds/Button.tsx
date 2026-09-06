import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'dark'
export type ButtonSize = 'small' | 'medium'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Rendered before the label, as in the mockups. */
  icon?: ReactNode
  fullWidth?: boolean
  children: ReactNode
}

// 4 variants x 2 sizes x 2 states. Disabled is the native attribute rather
// than a variant, so the button is genuinely inert and announced as such
// instead of merely looking greyed out.
export function Button({
  variant = 'primary',
  size = 'medium',
  icon,
  fullWidth = false,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  )
}
