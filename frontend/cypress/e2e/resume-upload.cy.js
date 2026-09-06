// Critical path 3 (docs/test-plan.md): upload interrupted -> resume with the
// correct file -> download intact, verified by checksum end to end. This is
// the flagship differentiator (US01-R), so unlike the other two scenarios it
// checks bytes, not just that a success screen appeared.

describe('Resume an upload interrupted by a reload', () => {
  const email = `cypress-resume-${Date.now()}@example.com`
  const password = 'cypressPass123'
  const fixturePath = 'cypress/fixtures/generated/resume-test.bin'
  const fileName = 'resume-test.bin'
  // cy.selectFile(path) stamps a fresh lastModified (current time) on the
  // synthetic File it builds each time it runs — so re-selecting "the same"
  // fixture twice produces two different lastModified values, and the
  // app's own identity check (deliberately strict, see US01-R) correctly
  // treats that as a different file. Pinning it here is the workaround.
  const FIXED_LAST_MODIFIED = Date.now()
  let token
  let originalMd5

  function selectGeneratedFile() {
    return cy.fixture('generated/resume-test.bin', null).then((contents) => {
      cy.get('input[type=file]').selectFile(
        {
          contents,
          fileName,
          mimeType: 'application/octet-stream',
          lastModified: FIXED_LAST_MODIFIED,
        },
        { force: true },
      )
    })
  }

  before(() => {
    // 9 MB / 8 MB parts = 2 parts — the minimum that's still a genuine
    // multipart interruption/resume, kept small deliberately (less to
    // upload, less for ClamAV to scan) since this scenario already exercises
    // real network I/O end to end. Random content: never accidentally
    // matches a magic-byte signature. Generated rather than committed — no
    // multi-MB binary belongs in the repo.
    cy.task('generateFile', { filePath: fixturePath, sizeBytes: 9 * 1024 * 1024 })
    cy.task('md5File', fixturePath).then((md5) => {
      originalMd5 = md5
    })

    cy.request('POST', '/api/auth/register', { email, password })
      .then(() => cy.request('POST', '/api/auth/login', { email, password }))
      .then(({ body }) => {
        token = body.token
      })
  })

  it('interrupts mid-upload, resumes with the same file, and the download matches byte for byte', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('datashare_token', token)
        // Same technique as the manual QA passes this project's docs
        // reference (see US01-C's verification notes): patch XHR.send to
        // delay each part, in-page, rather than via cy.intercept — a
        // Cypress-level response delay racing cy.reload()'s request abort
        // throws BrowserConnectionClosedError, which is a Cypress rough
        // edge, not anything about the app. 30 MB / 8 MB parts = 4 parts;
        // real localhost throughput would otherwise finish before a reload
        // command could land.
        const originalSend = win.XMLHttpRequest.prototype.send
        win.XMLHttpRequest.prototype.send = function (...args) {
          const xhr = this
          win.setTimeout(() => originalSend.apply(xhr, args), 700)
        }
      },
    })
    cy.contains('Tu veux partager un fichier ?').should('be.visible')

    selectGeneratedFile()
    cy.contains('button', 'Téléverser').click()

    // Land somewhere mid-transfer: past the first part's delay, well before
    // all four parts (~2.8s+) would have completed.
    cy.contains(/\d+ % —/, { timeout: 10000 }).should('be.visible')
    cy.wait(400)
    cy.reload()

    cy.contains('Tu veux partager un fichier ?').should('be.visible')

    cy.contains('button', 'Mon espace').click()
    cy.contains('Envois interrompus').should('be.visible')
    cy.contains('li', fileName).within(() => {
      cy.contains('button', 'Reprendre').click()
    })

    cy.contains("Reprendre l'envoi").should('be.visible')
    selectGeneratedFile()

    // The re-selected file is sample-verified (MD5 over a few completed
    // parts) before any byte moves, so this can take a little longer than
    // the initial "% —" appearance did.
    cy.contains(/\d+ % —/, { timeout: 20000 }).should('be.visible')
    cy.contains('Félicitations, ton fichier est prêt à être partagé', { timeout: 60000 }).should('be.visible')

    cy.get('a[href*="/d/"]')
      .invoke('attr', 'href')
      .then((href) => {
        cy.visit(href)
      })
    cy.contains('button', 'Télécharger').click()

    cy.readFile(`cypress/downloads/${fileName}`, { timeout: 30000 })
    cy.task('md5File', `cypress/downloads/${fileName}`).then((downloadedMd5) => {
      expect(downloadedMd5).to.eq(originalMd5)
    })
  })
})
