interface ContactDetails {
    name: string;
    email: string;
    phone: string;
  }
  
  interface KeyParties {
    customer_name: string;
    contact_details: ContactDetails;
  }
  
  interface BasicInfo {
    project_name: string;
    contract_start_date: string;
    contract_end_date: string;
    total_contract_value: number;
    brief_description: string;
    key_parties: KeyParties;
  }
  
  interface EnforceableRightsObligationsDetails {
    contract_date: string;
    customer_name: string;
    contract_number: string;
    contract_type: string;
  }
  
  interface EnforceableRightsObligations {
    details: EnforceableRightsObligationsDetails;
  }
  
  interface RenewablePODetails {
    name: string;
    description: string;
    duration: string;
  }
  
  interface RenewablePOs {
    details: RenewablePODetails[];
  }
  
  interface MultipleContracts {
    yes_no: boolean;
    should_they_be_combined_as_one_contract: {
      rationale: string;
    };
  }
  
  interface ClarityOfTermsPaymentTerms {
    clarity_of_terms: string;
    areas_lacking_clarity: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface PerformanceObligations {
    services_included: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface TransactionPrice {
    pricing_available: boolean;
    total_transaction_price: {
      amount_applicable_on_contract_date_including_variable_considerations: string;
    };
    compensation_structure: {
      details: Array<{
        name: string;
        description: string;
      }>;
    };
    variable_considerations: {
      available_yes_no: boolean;
      nature: Array<{
        name: string;
        amount: number;
        estimation: string;
      }>;
    };
    financing_components_non_cash_considerations_payable_amt_to_client: {
      yes_no: boolean;
      details: Array<{
        name: string;
        considerations: string;
      }>;
    };
  }
  
  interface FinancialTerms {
    payment_terms: Array<{
      name: string;
      description: string;
    }>;
    key_financial_obligations: Array<{
      payment_withholding: string;
      payment_withholding_condition: string;
    }>;
    revenue_recognition_overtime_or_pointintime: {
      method_used: string;
      basis_of_selecting_the_method: string;
    };
  }
  
  interface ServicesDistinctInNature {
    yes_no: boolean;
    how_service_meet_criterion: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface ContractModifications {
    yes_no: boolean;
    modifications_options: Array<{
      name: string;
      description: string;
      impact_on_revenue: string;
    }>;
  }
  
  interface OtherCosts {
    yes_no: boolean;
    details: Array<{
      cost: string;
      description: string;
      amount: number;
    }>;
  }
  
  interface ReimbursableExpenses {
    available_yes_no: boolean;
    details: Array<{
      cost: string;
      amount: number;
      description: string;
    }>;
  }
  
  interface NonRecoverableCosts {
    yes_no: boolean;
    details: Array<{
      name: string;
      amount: number;
      description: string;
    }>;
  }
  
  interface JudgementsEstimates {
    judgements_and_estimates: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface Disclosures {
    disclosures: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface ReviewApprovalDetails {
    reviewed_by: string;
    date_of_review: string;
    approved_by: string;
    date_of_approval: string;
    comments_or_notes: string;
  }
  
  interface ServicesDistinctInContract {
    yes_no: boolean;
    details: Array<{
      name: string;
      description: string;
    }>;
  }
  
  interface SupportingDocuments {
    contract_document: boolean;
    summary_of_contract_costs_resourcing_schedules: boolean;
    documentation_of_significant_judgements_or_estimates: boolean;
  }
  
  interface Contract {
    version: string | number;
    basic_info: BasicInfo;
    enforceable_rights_obligations: EnforceableRightsObligations;
    renewable_POs: RenewablePOs;
    multiple_contracts_with_customer: MultipleContracts;
    clarity_of_terms_payment_terms: ClarityOfTermsPaymentTerms;
    performance_obligations: PerformanceObligations;
    transaction_price: TransactionPrice;
    financial_terms: FinancialTerms;
    services_distinct_in_nature_as_seperate_POs: ServicesDistinctInNature;
    contract_modifications_or_variable_considerations_affecting_PO: ContractModifications;
    other_costs_associated_with_delivery: OtherCosts;
    reimbursable_expenses_billed_to_client_separately: ReimbursableExpenses;
    non_recoverable_costs: NonRecoverableCosts;
    judgements_or_estimates_made_for_applying_IFRS_15: JudgementsEstimates;
    specific_disclosures_required_to_comply_with_IFRS_15: Disclosures;
    review_approval_details: ReviewApprovalDetails;
    services_distinct_in_terms_of_contract: ServicesDistinctInContract;
    supporting_documents: SupportingDocuments;
  }
  
  interface ContractDetailsProps {
    contract: Contract;
    onSubmit: (data: Contract) => void;
    onFormSubmit: (data: Contract) => void;
    isLatestVersion: boolean;
    lastSave: any; // You might want to define a more specific type for lastSave
  }

  export type {
    ContractDetailsProps,
    Contract,
    BasicInfo,
    EnforceableRightsObligations,
    RenewablePOs,
    MultipleContracts,
    ClarityOfTermsPaymentTerms,
    PerformanceObligations,
    TransactionPrice,
    FinancialTerms,
    ServicesDistinctInNature,
    ContractModifications,
    OtherCosts,
    ReimbursableExpenses,
    NonRecoverableCosts,
    JudgementsEstimates,
    Disclosures,
    ReviewApprovalDetails,
    ServicesDistinctInContract,
    SupportingDocuments,
  }