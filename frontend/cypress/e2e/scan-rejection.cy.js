// Critical path 2 (docs/test-plan.md): upload -> scan rejects -> owner sees
// the reason in Mon espace -> no link ever existed. Pre-authenticates via
// the API (register+login) rather than the UI form, since that flow is
// already covered by register-upload-download.cy.js and isn't the point here.

describe('A file whose content contradicts its extension is rejected', () => {
  const email = `cypress-reject-${Date.now()}@example.com`
  const password = 'cypressPass123'
  let token

  before(() => {
    cy.request('POST', '/api/auth/register', { email, password })
      .then(() => cy.request('POST', '/api/auth/login', { email, password }))
      .then(({ body }) => {
        token = body.token
      })
  })

  it('shows the rejection in the uploader, then in Mon espace, with no download link', () => {
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('datashare_token', token)
      },
    })
    cy.contains('Tu veux partager un fichier ?').should('be.visible')

    // fake-image.jpg is plain text — the worker's magic-byte check rejects
    // it before ever reaching ClamAV, so this resolves fast.
    cy.get('input[type=file]').selectFile('cypress/fixtures/fake-image.jpg', { force: true })
    cy.contains('button', 'Téléverser').click()

    cy.contains(/Fichier refus/, { timeout: 30000 }).should('be.visible')

    cy.contains('button', 'Mon espace').click()
    cy.contains('li', 'fake-image.jpg').within(() => {
      cy.contains('Refusé').should('be.visible')
      cy.contains('button', 'Accéder').should('not.exist')
    })
  })
})
