// fieldDescriptions.ts
export const fieldDescriptions: Record<string, string> = {
    // Basic Info
    "basic_info.project_name": "The name of the project as specified in the contract.",
    "basic_info.contract_start_date": "The start date of the contract.",
    "basic_info.contract_end_date": "The end date of the contract.",
    "basic_info.total_contract_value": "The total value of the contract.",
    "basic_info.brief_description": "A brief description of the project.",
    "basic_info.key_parties.customer_name": "The name of the customer.",
    "basic_info.key_parties.contact_details.name": "The name of the key contact person.",
    "basic_info.key_parties.contact_details.email": "The email address of the key contact person.",
    "basic_info.key_parties.contact_details.phone": "The phone number of the key contact person.",
  
    // Enforceable Rights and Obligations
    "enforceable_rights_obligations.enforceable_rights_obligations": "Is there a contract with a customer that creates enforceable rights and obligations? If yes, extract the details.",
    "enforceable_rights_obligations.details.contract_date": "The date of the contract.",
    "enforceable_rights_obligations.details.customer_name": "The name of the customer.",
    "enforceable_rights_obligations.details.contract_number": "The contract number.",
    "enforceable_rights_obligations.details.contract_type": "The type of contract.",
  
    // Contract Duration
    "contract_duration": "The duration of the contract.",
  
    // Renewable POs
    "renewable_POs.availability": "Read the contract text and answer by your understanding, Does this contract have renewable POs? If yes, extract the details.",
    "renewable_POs.details.name": "The name of the renewable PO.",
    "renewable_POs.details.description": "A description of the renewable PO.",
    "renewable_POs.details.duration": "The duration of the renewable PO.",
  
    // Multiple Contracts with Customer
    "multiple_contracts_with_customer.yes_no": "Read the contract text and answer by your understanding, Are there multiple contracts with the same customer? If so, should they be combined as a single contract under IFRS 15? - If yes: Provide rationale for combining contracts.",
    "multiple_contracts_with_customer.should_they_be_combined_as_one_contract.rationale": "The rationale for combining multiple contracts.",
  
    // Clarity of Terms and Payment Terms
    "clarity_of_terms_payment_terms.clarity_of_terms": "Read the contract text and answer by your understanding, Does the contract have clear terms, including payment terms and the goods/services to be transferred? - If no: List the areas lacking clarity.",
    "clarity_of_terms_payment_terms.areas_lacking_clarity.name": "The name of the area lacking clarity.",
    "clarity_of_terms_payment_terms.areas_lacking_clarity.description": "A description of the area lacking clarity.",
  
    // Performance Obligations
    "performance_obligations.distinct_services_promised": "Read the contract text and answer by your understanding, What distinct services are promised in the contract? Provide a list of services included in the contract.",
    "performance_obligations.services_included.name": "The name of the service included in the contract.",
    "performance_obligations.services_included.description": "A description of the service included in the contract.",
  
    // Services Distinct in Nature as Separate POs
    "services_distinct_in_nature_as_seperate_POs.yes_no": "Read the contract text and answer by your understanding, Are the services provided potentially distinct in nature as separate performance obligations? - If yes: Specify how each good/service meets this criterion.",
    "services_distinct_in_nature_as_seperate_POs.how_service_meet_criterion.name": "The name of the service.",
    "services_distinct_in_nature_as_seperate_POs.how_service_meet_criterion.description": "A description of how the service meets the criterion.",
  
    // Services Distinct in Terms of Contract
    "services_distinct_in_terms_of_contract.yes_no": "Read the contract text and answer by your understanding, Are the services distinct in terms of the contract and identifiable as separate performance obligations? - Provide details.",
    "services_distinct_in_terms_of_contract.details.name": "The name of the service.",
    "services_distinct_in_terms_of_contract.details.description": "A description of the service.",
  
    // Contract Modifications or Variable Considerations Affecting PO
    "contract_modifications_or_variable_considerations_affecting_PO.yes_no": "Read the contract text and answer by your understanding, Are there any contract modifications, options, or variable considerations that may affect performance obligations? - If yes: Describe the modifications or options and their potential impact on revenue recognition.",
    "contract_modifications_or_variable_considerations_affecting_PO.modifications_options.name": "The name of the modification.",
    "contract_modifications_or_variable_considerations_affecting_PO.modifications_options.description": "A description of the modification.",
    "contract_modifications_or_variable_considerations_affecting_PO.modifications_options.impact_on_revenue": "The impact of the modification on revenue recognition.",
  
    // Transaction Price
    "transaction_price.pricing_available": "Read the contract text and answer by your understanding, What is the total transaction price for the contract? - Provide the total amount applicable on contract date, including any variable consideration.",
    "transaction_price.total_transaction_price.amount_applicable_on_contract_date_including_variable_considerations": "The total transaction price, including variable considerations.",
    "transaction_price.compensation_structure.available_yes_no": "Read the contract text and answer by your understanding, Is the compensation structure available? - Provide details on applicable fee structure: Fixed fee, lump sum, time and materials, etc.",
    "transaction_price.compensation_structure.details.name": "The name of the compensation structure.",
    "transaction_price.compensation_structure.details.description": "A description of the compensation structure.",
    "transaction_price.variable_considerations.available_yes_no": "Read the contract text and answer by your understanding, Does the contract include variable consideration (e.g., discounts, rebates, performance bonuses, penalties)? - If yes: Describe the nature and how it is estimated.",
    "transaction_price.variable_considerations.nature.name": "The name of the variable consideration.",
    "transaction_price.variable_considerations.nature.amount": "The amount of the variable consideration.",
    "transaction_price.variable_considerations.nature.estimation": "The estimation method for the variable consideration.",
    "transaction_price.financing_components_non_cash_considerations_payable_amt_to_client.yes_no": "Read the contract text and answer by your understanding, Are there any significant financing components, non-cash considerations, or payable amounts to clients within the contract? - If yes: Detail how these will be considered in revenue recognition.",
    "transaction_price.financing_components_non_cash_considerations_payable_amt_to_client.details.name": "The name of the financing component or non-cash consideration.",
    "transaction_price.financing_components_non_cash_considerations_payable_amt_to_client.details.considerations": "Details of the financing component or non-cash consideration.",
  
    // Other Costs Associated with Delivery
    "other_costs_associated_with_delivery.yes_no": "Read the contract text and answer by your understanding, Other costs associated with delivery of these services. Travel expenses, overheads included in a contract fee? - Provide details.",
    "other_costs_associated_with_delivery.details.cost": "The type of cost.",
    "other_costs_associated_with_delivery.details.amount": "The amount of the cost.",
    "other_costs_associated_with_delivery.details.description": "A description of the cost.",
  
    // Reimbursable Expenses Billed to Client Separately
    "reimbursable_expenses_billed_to_client_separately.available_yes_no": "Read the contract text and answer by your understanding, Other project reimbursable expenses which can be billed to the client separately. - If yes: provide details.",
    "reimbursable_expenses_billed_to_client_separately.details.expense": "The type of reimbursable expense.",
    "reimbursable_expenses_billed_to_client_separately.details.amount": "The amount of the reimbursable expense.",
    "reimbursable_expenses_billed_to_client_separately.details.description": "A description of the reimbursable expense.",
  
    // Non-Recoverable Costs
    "non_recoverable_costs.yes_no": "Read the contract text and answer by your understanding, Other potential non-recoverable costs. E.g., Demobilisation - If yes: provide details.",
    "non_recoverable_costs.details.name": "The name of the non-recoverable cost.",
    "non_recoverable_costs.details.amount": "The amount of the non-recoverable cost.",
    "non_recoverable_costs.details.description": "A description of the non-recoverable cost.",
  
    // Calculation of Price Allocation for POs
    "calculation_of_price_allocation_for_POs.method_used": "Read the contract text and answer by your understanding, How is the transaction price allocated among the performance obligations? - Describe the method used (e.g., relative standalone selling prices).",
    "calculation_of_price_allocation_for_POs.description": "A description of the method used for price allocation.",
  
    // Standalone Prices for Each Obligation
    "standalone_prices_for_each_obligation.yes_no": "Read the contract text and answer by your understanding, Are standalone selling prices available for each performance obligation? - If no: Describe the estimation method used.",
    "standalone_prices_for_each_obligation.method_used_for_estimation": "The method used for estimating standalone selling prices.",
    "standalone_prices_for_each_obligation.description": "A description of the estimation method.",
  
    // Discounts or Variable Considerations Specific to Obligations
    "discounts_variable_considerations_specific_to_obligations.yes_no": "Read the contract text and answer by your understanding, Does any discount or variable consideration apply specifically to one or more performance obligations? - If yes: Specify how it impacts allocation.",
    "discounts_variable_considerations_specific_to_obligations.impact_on_allocation": "The impact of the discount or variable consideration on price allocation.",
  
    // Milestones or KPIs
    "milestones_or_kpiS.available_yes_no": "Read the contract text and answer by your understanding, Are there milestones or KPIs applicable to the contract? - Provide details on how performance is measured.",
    "milestones_or_kpiS.details.how_measured_performance": "A description of how performance is measured.",
  
    // Financial Terms
    "financial_terms.payment_terms.name": "The name of the payment term.",
    "financial_terms.payment_terms.description": "A description of the payment term.",
    "financial_terms.revenue_recognition_overtime_or_pointintime.basis": "Read the contract text and answer by your understanding, Is the revenue recognized over time or at a point in time? If over time, provide the basis.",
    "financial_terms.revenue_recognition_overtime_or_pointintime.description": "A description of the revenue recognition basis.",
    "financial_terms.for_PO_recognition_overtime_method_used_for_measuring_progress.Input/Output Method": "Read the contract text and answer by your understanding, For performance obligations recognized over time, what method is used to measure progress? (Input/Output method).",
    "financial_terms.for_PO_recognition_overtime_method_used_for_measuring_progress.basis_of_selecting_the_method": "Read the contract text and answer by your understanding, For performance obligations recognized over time, what method is used to measure progress? Provide the basis of selecting the model.",
    "financial_terms.key_financial_obligations.payment_withholding": "The payment withholding condition.",
    "financial_terms.key_financial_obligations.payment_withholding_condition": "The condition for payment withholding.",
  };

  export default fieldDescriptions;