// RFC 1321 MD5, operating on an ArrayBuffer. Needed only to compare a
// resumed upload's sampled parts against the ETags S3 already returned —
// SubtleCrypto has no MD5, and this is a content-integrity check, not a
// security boundary, so a plain from-spec implementation is the right size
// dependency (none) for what it does.

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c))
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
]

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5Hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const bitLen = bytes.length * 8

  // Pad: 0x80, then zeros, then the 64-bit little-endian length, to a
  // multiple of 64 bytes.
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, bitLen >>> 0, true)
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(chunkStart + i * 4, true)
    }

    let [a, b, c, d] = [a0, b0, c0, d0]

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      f = (f + a + K[i] + M[g]) >>> 0
      a = d
      d = c
      c = b
      b = (b + rotl(f, S[i])) >>> 0
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  return [a0, b0, c0, d0].map(toLittleEndianHex).join('')
}

function toLittleEndianHex(word: number): string {
  const bytes = [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff]
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}
