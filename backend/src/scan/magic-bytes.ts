// Table de signatures écrite à la main plutôt qu'une dépendance (`file-type`
// est passé en ESM pur, ce qui se heurte au CJS de ce projet pour un bénéfice
// nul ici). L'objectif n'est pas de reconnaître tous les formats du monde :
// c'est de refuser une extension usurpée, donc de détecter une CONTRADICTION
// entre l'extension déclarée et les octets réels.
interface Signature {
  // Décalage où la signature commence (rarement autre chose que 0).
  offset: number;
  bytes: number[];
}

// Extensions dont les octets sont vérifiables. Une extension absente de cette
// table n'est jamais refusée : on ne sait pas la vérifier, on ne prétend pas
// le contraire (.txt et .csv n'ont aucune signature, par exemple).
const SIGNATURES: Record<string, Signature[]> = {
  pdf: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  png: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  jpg: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  jpeg: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  gif: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF8
  // Conteneur ZIP : couvre le .zip lui-même et les formats Office modernes.
  zip: [{ offset: 0, bytes: [0x50, 0x4b] }],
  docx: [{ offset: 0, bytes: [0x50, 0x4b] }],
  xlsx: [{ offset: 0, bytes: [0x50, 0x4b] }],
  pptx: [{ offset: 0, bytes: [0x50, 0x4b] }],
  gz: [{ offset: 0, bytes: [0x1f, 0x8b] }],
  mp4: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // ....ftyp
  mp3: [
    { offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3
    { offset: 0, bytes: [0xff, 0xfb] },
  ],
};

function matches(head: Buffer, signature: Signature): boolean {
  if (head.length < signature.offset + signature.bytes.length) {
    return false;
  }
  return signature.bytes.every(
    (byte, i) => head[signature.offset + i] === byte,
  );
}

export type MagicBytesVerdict =
  | { kind: 'match' }
  | { kind: 'unverifiable' }
  | { kind: 'mismatch'; expected: string };

// Ne renvoie `mismatch` QUE si l'extension est connue de la table et que les
// octets la contredisent. Une extension inconnue renvoie `unverifiable` : le
// contrôle antivirus reste, lui, systématique.
export function verifyMagicBytes(
  extension: string,
  head: Buffer,
): MagicBytesVerdict {
  const signatures = SIGNATURES[extension.toLowerCase()];
  if (!signatures) {
    return { kind: 'unverifiable' };
  }
  if (signatures.some((signature) => matches(head, signature))) {
    return { kind: 'match' };
  }
  return { kind: 'mismatch', expected: extension.toLowerCase() };
}
