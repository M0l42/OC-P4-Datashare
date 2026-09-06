// Critical path 1 (docs/test-plan.md): register -> login -> upload -> copy
// link -> recipient downloads. Runs the real registration form rather than
// pre-authenticating via API, since that flow (and the auto-login it chains
// into) is itself part of what this scenario is meant to prove works.

describe('Register, upload, and recipient download', () => {
  const email = `cypress-happy-${Date.now()}@example.com`
  const password = 'cypressPass123'

  it('registers a new account, uploads a file, and the recipient can access it', () => {
    cy.visit('/')

    cy.contains('button', 'Créer un compte').click()
    cy.contains('h1', 'Créer un compte').should('be.visible')

    cy.get('input[type=email]').type(email)
    cy.get('input[type=password]').eq(0).type(password)
    cy.get('input[type=password]').eq(1).type(password)
    cy.contains('button', 'Créer mon compte').click()

    // Auto-login lands straight in the uploader — no separate login step.
    cy.contains('Tu veux partager un fichier ?').should('be.visible')

    cy.get('input[type=file]').selectFile('cypress/fixtures/happy-path.txt', { force: true })
    cy.contains('h1', 'Ajouter un fichier').should('be.visible')
    cy.contains('button', 'Téléverser').click()

    cy.contains('Félicitations, ton fichier est prêt à être partagé', { timeout: 30000 }).should('be.visible')

    cy.get('a[href*="/d/"]')
      .invoke('attr', 'href')
      .should('include', '/d/')
      .then((href) => {
        cy.visit(href)
      })

    cy.contains('Télécharger un fichier').should('be.visible')
    cy.contains('happy-path.txt').should('be.visible')
    cy.contains('button', 'Télécharger').should('be.enabled').click()

    cy.readFile('cypress/downloads/happy-path.txt', { timeout: 15000 }).should(
      'eq',
      'Cypress E2E fixture for the register -> upload -> download scenario.\n',
    )
  })
})
