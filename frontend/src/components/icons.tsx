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
