// testing/e2e/cypress/e2e/contract-lifecycle.cy.ts

describe('Contract Lifecycle Golden Path', () => {
  // Define constants for users and the base fixture file
  const UPLOADER = { username: 'test-uploader', password: 'password123' };
  const EDITOR = { username: 'test-editor', password: 'password123' };
  const APPROVER = { username: 'test-approver', password: 'password123' };
  const BASE_CONTRACT_FIXTURE = 'sample-contract.pdf';

  // --- TEST RUN ISOLATION ---
  // Create a unique identifier for this specific test run.
  // This ensures that if the test is run multiple times, the contract name will be unique,
  // preventing collisions with data from previous test runs.
  const testRunId = Date.now();
  const UNIQUE_CONTRACT_FILENAME = `${testRunId}-${BASE_CONTRACT_FIXTURE}`;
  // --- END ISOLATION ---

  // The before() hook runs ONCE before all tests. It sets up the initial state.
  before(() => {
    cy.prepareDatabase(); // Use the destructive reset for local runs
    cy.login(UPLOADER.username, UPLOADER.password);
    cy.visit('/dashboard');
    cy.intercept('GET', '**/api/v1/users/me/accounts').as('getAccounts');
    cy.intercept('GET', '**/api/v1/documents/**').as('getDocuments');
    
    cy.log(`**SETUP: Uploading contract with unique name: ${UNIQUE_CONTRACT_FILENAME}**`);
    
    cy.wait('@getAccounts');
    cy.get('[data-cy="account-switcher-trigger"]').click();
    cy.contains('[data-cy="account-option"]', 'E2E Pro Team').click();
    cy.wait('@getDocuments');

    cy.get('[data-cy="dashboard-upload-button"]').click();

    // Upload the fixture file but give it our new, unique filename
    cy.get('input[type="file"]').selectFile({
      contents: `testing/e2e/cypress/fixtures/${BASE_CONTRACT_FIXTURE}`,
      fileName: UNIQUE_CONTRACT_FILENAME,
    }, { force: true });

    cy.get('div[role="dialog"]').find('button:contains("Upload")').click();
    cy.contains('button', 'Assign Roles', { timeout: 10000 }).should('be.visible');

    // Role assignment remains the same
    cy.get('[data-cy="editor-select-trigger"]').click();
    cy.get('div[role="option"]').contains(EDITOR.username).click();
    cy.get('[data-cy="approver-select-trigger"]').click();
    cy.get('div[role="option"]').contains(APPROVER.username).click();
    cy.get('[data-cy="assign-roles-button"]').click();
    cy.get('[data-cy="assign-roles-button"]').should('contain.text', 'Assigned');
    cy.get('button:contains("Done")').click();
    
    cy.wait('@getDocuments');
    // Verify the contract is visible on the dashboard using its unique name
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME).should('be.visible');
  });

  // The beforeEach() hook runs before EACH `it()` block.
  beforeEach(() => {
    cy.intercept('GET', '**/api/v1/documents/**').as('getDocuments');
    cy.intercept('GET', '**/api/v1/users/me/accounts').as('getAccounts');
    cy.intercept('POST', '**/api/v1/contracts/*/submit').as('submitForApproval');
    cy.intercept('POST', '**/api/v1/contracts/*/approve').as('approveContract');
  });

  it('should allow the Editor to process the contract and then submit for approval', () => {
    cy.login(EDITOR.username, EDITOR.password);
    cy.visit('/dashboard');
    cy.wait('@getDocuments');
    cy.wait('@getAccounts');
    
    cy.log('**EDITOR: Switching to the correct team account context**');
    cy.get('[data-cy="account-switcher-trigger"]').click();
    cy.contains('[data-cy="account-option"]', 'E2E Pro Team').click();
    cy.wait('@getDocuments');

    // --- All subsequent commands now use UNIQUE_CONTRACT_FILENAME ---
    cy.log('**EDITOR: Finding contract and starting the processing**');
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME).within(() => {
      cy.get('button:contains("Process")').click();
    });

    cy.log('**EDITOR: Selecting, saving, and confirming questions**');
    cy.get('div[role="dialog"]').should('be.visible');
    cy.get('h2').should('contain', 'Verify Questions Before Processing');
    cy.get('label[for^="std-cat-"]').first().click();
    cy.get('div.sticky.bottom-0').find('button:contains("Save Selection")').should('not.be.disabled').click();
    cy.contains('Questions Saved').should('be.visible');
    cy.get('div[role="dialog"]').find('button:contains("Confirm and Process")').should('not.be.disabled').click();

    cy.log('**EDITOR: Waiting for processing to complete...**');
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME)
      .find('span:contains("Ready to Edit")', { timeout: 60000 })
      .should('be.visible');
    
    cy.log('**EDITOR: Submitting for approval**');
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME).find('button:contains("View")').click();
    cy.url().should('include', '/contracts/');
    cy.get('button:contains("Submit for Approval")').click();
    cy.wait('@submitForApproval');
    cy.get('span:contains("Submitted")').should('be.visible');
  });

  it('should allow the Approver to approve the contract, moving it to History', () => {
    cy.login(APPROVER.username, APPROVER.password);
    cy.visit('/dashboard');
    cy.wait('@getDocuments');
    cy.wait('@getAccounts');
    
    cy.log('**APPROVER: Switching to the correct team account context**');
    cy.get('[data-cy="account-switcher-trigger"]').click();
    cy.contains('[data-cy="account-option"]', 'E2E Pro Team').click();
    cy.wait('@getDocuments');

    cy.log('**APPROVER: Verifying status and approving**');
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME)
      .find('span:contains("Pending Your Approval")')
      .should('be.visible');

    cy.contains('tr', UNIQUE_CONTRACT_FILENAME).find('button:contains("View")').click();
    cy.url().should('include', '/contracts/');
    cy.get('button:contains("Approve")').click();
    cy.wait('@approveContract');
    cy.get('span:contains("Completed")').should('be.visible');

    cy.log('**APPROVER: Verifying contract is now in History**');
    cy.visit('/history');
    cy.wait('@getDocuments');
    cy.contains('tr', UNIQUE_CONTRACT_FILENAME).should('be.visible');
  });
});
