import { defineConfig } from 'cypress'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

// Plain JS, not TS: Cypress 15's bundled tsx loader hard-requires Node's
// newer --import semantics (Node >=18.19.0/20.6.0), but the launcher still
// invokes it via the older --loader flag, which now throws instead of
// warning on this host's Node 18.19.1. Sidestepping the TS loader entirely
// is simpler than fighting a Cypress/Node version mismatch we don't control.
export default defineConfig({
  e2e: {
    // The full stack behind nginx (front + /api), same URL used for manual
    // QA all through this project — not the bare Vite dev server, since
    // these tests exercise real multipart uploads against MinIO.
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:8080',
    supportFile: false,
    downloadsFolder: 'cypress/downloads',
    setupNodeEvents(on) {
      on('task', {
        // Generates a fixture on demand rather than committing a multi-MB
        // binary to the repo. Content is random, so a magic-byte check never
        // accidentally matches a real signature.
        generateFile({ filePath, sizeBytes }) {
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, crypto.randomBytes(sizeBytes))
          return null
        },
        md5File(filePath) {
          return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex')
        },
      })
    },
  },
})
