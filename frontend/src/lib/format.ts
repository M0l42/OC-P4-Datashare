const UNITS = ['octets', 'Ko', 'Mo', 'Go']

export function formatFileSize(bytes: number): string {
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }
  const formatted =
    unitIndex === 0 ? String(value) : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
  return `${formatted} ${UNITS[unitIndex]}`
}
