import type { ReactNode } from 'react'

export type CalloutVariant = 'info' | 'alert' | 'error'

const COLORS: Record<CalloutVariant, { border: string; bg: string; text: string }> = {
  info: { border: '#8ab4f8', bg: '#e8f0fe', text: '#1a56db' },
  alert: { border: '#f5b942', bg: '#fef3e2', text: '#9a5b00' },
  error: { border: '#f28b82', bg: '#fdecea', text: '#a80000' },
}

interface CalloutProps {
  variant: CalloutVariant
  children: ReactNode
}

// Motif unique pour tout message d'état du produit (DESIGN.md : « ne pas
// coder de bordures colorées à la main »). Styles ci-dessous provisoires,
// plats : le rendu final vient des tokens du design system (UI-02, pas
// encore câblé) — seul le contrat (une variante, un composant) est fixé ici.
export function Callout({ variant, children }: CalloutProps) {
  const colors = COLORS[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      style={{
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.text,
        borderRadius: 4,
        padding: '0.75rem 1rem',
        fontSize: '0.9rem',
      }}
    >
      {children}
    </div>
  )
}
