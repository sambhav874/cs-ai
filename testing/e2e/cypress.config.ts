// cypress.config.ts

import { defineConfig } from 'cypress'

export default defineConfig({
  fixturesFolder: 'testing/e2e/cypress/fixtures',
  screenshotsFolder: 'testing/e2e/cypress/screenshots',
  videosFolder: 'testing/e2e/cypress/videos',
  downloadsFolder: 'testing/e2e/cypress/downloads',
  // This section is for E2E specific configuration
  e2e: {
    // This is the URL of your Next.js frontend when you run it locally.
    // Cypress will automatically visit this URL.
    baseUrl: 'http://localhost:4200',

    // This tells Cypress to load the support file before running tests.
    // It's where we will put our custom commands like cy.login().
    supportFile: 'testing/e2e/cypress/support/e2e.ts',
    specPattern: 'testing/e2e/cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',

    // A good default screen size for your tests.
    viewportWidth: 1440,
    viewportHeight: 900,

    // A higher timeout can be helpful for CI environments or slow API calls.
    // This is the max time Cypress will wait for an element to appear.
    defaultCommandTimeout: 10000, // 10 seconds

    // When a test fails, Cypress automatically records a video.
    video: true,
    retries:2
  },
})
