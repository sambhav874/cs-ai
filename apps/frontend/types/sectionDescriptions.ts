// FileDescription.ts

// First, define the type for all possible section description keys
export type SectionDescriptionKey =
  | 'basicInformation'
  | 'enforceableRights'
  | 'contractDuration'
  | 'renewablePOs'
  | 'multipleContracts'
  | 'clarityOfTerms'
  | 'performanceObligations'
  | 'transactionPrice'
  | 'financialTerms'
  | 'servicesDistinctNature'
  | 'contractModifications'
  | 'associatedCosts'
  | 'priceAllocation'
  | 'milestonesAndKPIs'
  | 'ifrsCompliance'
  | 'reviewAndApproval'
  | 'servicesDistinctContract'
  | 'supportingDocuments'
  | 'reimbursableExpenses'
  | 'variableConsiderations'
  | 'financingComponents'
  | 'poRecognition';

// Define the type for the section descriptions object
export type SectionDescriptions = Record<SectionDescriptionKey, string>;

// Create and export the section descriptions
export const sectionDescriptions: SectionDescriptions = {
  basicInformation: "Contains fundamental contract details including project information, dates, value, and key stakeholder contact information.",
  enforceableRights: "Details about the contract's legal enforceability, dates, and related documentation.",
  contractDuration: "Specifies the timeline and duration of the contract agreement.",
  renewablePOs: "Information about renewable purchase orders and their details.",
  multipleContracts: "Details about multiple contract relationships with the customer and combination rationale.",
  clarityOfTerms: "Assessment of contract terms clarity and areas requiring clarification.",
  performanceObligations: "Details the specific services and deliverables promised under the contract, including distinct service offerings and their descriptions.",
  transactionPrice: "Outlines the financial aspects of the contract including total price, compensation structure, and pricing availability.",
  financialTerms: "Specifies payment conditions, revenue recognition policies, and key financial obligations under the contract.",
  servicesDistinctNature: "Explains how different services within the contract are considered separate performance obligations.",
  contractModifications: "Details any changes or amendments to the original contract terms and variable considerations.",
  associatedCosts: "Lists various costs related to contract delivery including reimbursable expenses and non-recoverable costs.",
  priceAllocation: "Describes how the total contract price is allocated across different performance obligations.",
  milestonesAndKPIs: "Outlines key performance indicators and milestone achievements required by the contract.",
  ifrsCompliance: "Details compliance requirements with IFRS 15 including necessary judgements and disclosures.",
  reviewAndApproval: "Contains information about the contract review process including approvers and relevant dates.",
  servicesDistinctContract: "Explains how services are distinguished within the context of the contract terms.",
  supportingDocuments: "Lists the available supporting documentation for the contract.",
  reimbursableExpenses: "Details of expenses that can be billed separately to the client for reimbursement.",
  variableConsiderations: "Information about variable elements of the contract price and their estimation methods.",
  financingComponents: "Details about financing components and non-cash considerations in the contract.",
  poRecognition: "Information about the recognition of performance obligations over time and measurement methods."
} as const;

// Export the props interface
export interface SectionTitleProps {
  title: string;
  descriptionKey: SectionDescriptionKey;
}

// Create a type guard to check if a key exists in sectionDescriptions
export function isSectionDescriptionKey(key: string): key is SectionDescriptionKey {
  return key in sectionDescriptions;
}

// You can also create a helper function to get description safely
export function getSectionDescription(key: SectionDescriptionKey): string {
  return sectionDescriptions[key];
}