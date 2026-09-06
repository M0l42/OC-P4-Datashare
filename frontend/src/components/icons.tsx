// Icons shared between the upload and download screens — kept in one place
// so the upload/download arrows and copy glyph stay visually consistent.

export function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 16.5a4 4 0 0 1 .5-7.97A5 5 0 0 1 17 10a3.5 3.5 0 0 1-.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 20v-7m0 0-2.5 2.5M12 13l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Same cloud as UploadIcon, arrow pointing down — as in the "Télécharger" button.
export function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 16.5a4 4 0 0 1 .5-7.97A5 5 0 0 1 17 10a3.5 3.5 0 0 1-.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 13v7m0 0-2.5-2.5M12 20l2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Two overlapping rounded rectangles, as in the "Copier le lien" mockup.
export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

// Open padlock, for the password badge on a Mon espace row.
export function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7V5a3 3 0 0 1 5.5-1.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

// The Supprimer icon, same trash-can outline in both the row buttons and the
// mobile action sheet.
export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Points at the file's own page — used on the "Accéder" row action.
export function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Vertical dots — opens the mobile action sheet, standing in for the
// desktop row's inline buttons.
export function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="3.2" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="12.8" r="1.2" fill="currentColor" />
    </svg>
  )
}

// Door with an outward arrow, for "Déconnexion".
export function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M7 2.5H3.8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6.5 8H14m0 0-2.3-2.3M14 8l-2.3 2.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Opens the mobile nav drawer on Mon espace.
export function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Closes the drawer, same weight as MenuIcon so the two read as a pair.
export function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// A folded-corner document with the sun/mountain glyph inside, exactly as in
// the file-row mockups (used for every file, not just images).
export function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 2.5h6.5L16 7v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M11.5 2.5V7h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="7.3" cy="10.3" r="1" fill="currentColor" />
      <path d="M6.2 14 9 10.3l2 2.2 1.3-1.5L14.5 14H6.2Z" fill="currentColor" />
    </svg>
  )
}
