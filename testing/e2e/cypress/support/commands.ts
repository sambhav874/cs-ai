/// <reference types="cypress" />

// This block adds the custom commands to TypeScript's Cypress namespace for autocompletion.
declare namespace Cypress {
  interface Chainable {
    /**
     * Prepares the database for a test run.
     * - In LOCAL testing, it WIPES and SEEDS the database.
     * - In DEV/CI testing, it SAFELY ensures test users exist.
     * Controlled by the `CYPRESS_TARGET_ENV` environment variable.
     * @example cy.prepareDatabase()
     */
    prepareDatabase(): Chainable<void>

    /**
     * Custom command to log in a user, caching the session for speed.
     * @example cy.login('test-editor', 'password123')
     */
    login(username: string, password: string): Chainable<void>
  }
}

/**
 * This is our new, environment-aware command to set up the database.
 */
Cypress.Commands.add('prepareDatabase', () => {
  // Cypress.env('TARGET_ENV') gets the CYPRESS_TARGET_ENV variable.
  // We set this to 'dev' in our smoke-test-dev.yml workflow file.
  const targetEnv = Cypress.env('TARGET_ENV');

  if (targetEnv === 'dev') {
    // --- LIVE DEV ENVIRONMENT ---
    // In this mode, we call the safe, non-destructive endpoint.
    const backendUrl = Cypress.env('BACKEND_URL');
    cy.log(`Running against DEV environment. Ensuring test users exist at ${backendUrl}`);
    
    if (!backendUrl) {
      throw new Error("CYPRESS_BACKEND_URL environment variable is not set");
    }

    cy.request({
      method: 'POST',
      url: `${backendUrl}/api/v1/testing/ensure-users`,
      // You may need to add an Authorization header here in the future
      // if you secure this endpoint.
    }).its('status').should('eq', 200);

  } else {
    // --- LOCAL TESTING (DEFAULT BEHAVIOR) ---
    // If no target is specified, we assume local testing and wipe the database.
    cy.log('Running locally. Resetting and seeding the database.');
    cy.request({
      method: 'POST',
      url: 'http://localhost:8000/api/v1/testing/reset-and-seed', 
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.message).to.include('seeded with a Pro account');
    });
  }
});

/**
 * This is your robust login command. It remains unchanged.
 */
Cypress.Commands.add('login', (username, password) => {
  cy.session([username, password], () => {
    cy.intercept('GET', '**/api/v1/users/me/').as('getUser');
    cy.visit('/signin');
    cy.get('input#username').type(username);
    cy.get('input#password').type(password, { log: false });
    cy.get('button[type="submit"]').click();
    cy.wait('@getUser').its('response.statusCode').should('eq', 200);
    cy.url().should('include', '/dashboard');
    cy.contains('h1', 'Contract Dashboard').should('be.visible');
  });
});