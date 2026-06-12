export const contractAnalysisSchema = {
    basic_info: {
      project_name: "The name of the project",
      contract_start_date: "The start date of the contract",
      contract_end_date: "The end date of the contract",
      total_contract_value: "The total monetary value of the contract",
      brief_description: "A brief description of the project",
      key_parties: {
        customer_name: "The name of the customer",
        contact_details: {
          name: "The name of the primary contact person",
          email: "The email address of the primary contact person",
          phone: "The phone number of the primary contact person"
        }
      }
    },
    enforceable_rights_obligations: {
      enforceable_rights_obligations: "Is there a contract with a customer that creates enforceable rights and obligations? If yes, extract the details.",
      details: {
        contract_date: "The date of the contract",
        customer_name: "The name of the customer on the contract",
        contract_number: "The contract number",
        contract_type: "The type of contract"
      }
    },
    contract_duration: "The duration of the contract",
    renewable_POs: {
      availability: "Read the contract text and answer by your understanding, Does this contract have renewable POs? If yes, extract the details.",
      details: [
        {
          name: "The name of the renewable PO",
          description: "A description of the renewable PO",
          duration: "The duration of the renewable PO"
        }
      ]
    },
    multiple_contracts_with_customer: {
      yes_no: "Read the contract text and answer by your understanding, Are there multiple contracts with the same customer? If so, should they be combined as a single contract under IFRS 15?  - If yes: Provide rationale for combining contracts.",
      should_they_be_combined_as_one_contract: {
        rationale: "The rationale for combining contracts, if applicable"
      }
    },
    clarity_of_terms_payment_terms: {
      clarity_of_terms: "Read the contract text and answer by your understanding, Does the contract have clear terms, including payment terms and the goods/services to be transferred?  - If no: List the areas lacking clarity.",
      areas_lacking_clarity: [
        {
          name: "The name of the area lacking clarity",
          description: "A description of the area lacking clarity"
        }
      ]
    },
    performance_obligations: {
      distinct_services_promised: "Read the contract text and answer by your understanding, What distinct services are promised in the contract? Provide a list of services included in the contract.",
      services_included: [
        {
          name: "The name of the service",
          description: "A description of the service"
        }
      ]
    },
    services_distinct_in_nature_as_seperate_POs: {
      yes_no: "Read the contract text and answer by your understanding, Are the services provided potentially distinct in nature as separate performance obligations . - If yes: Specify how each good/service meets this criterion.",
      how_service_meet_criterion: [
        {
          name: "The name of the service",
          description: "A description of how the service meets the criterion"
        }
      ]
    },
    services_distinct_in_terms_of_contract: {
      yes_no: "Read the contract text and answer by your understanding, Are the services distinct in terms of the contract and identifiable as separate performance obligations?  - Provide details",
      details: [
        {
          name: "The name of the service",
          description: "A description of how the service is distinct in terms of the contract"
        }
      ]
    },
    contract_modifications_or_variable_considerations_affecting_PO: {
      yes_no: "Read the contract text and answer by your understanding, Are there any contract modifications, options, or variable considerations that may affect performance obligations? - If yes: Describe the modifications or options and their potential impact on revenue recognition.  Provide details",
      modifications_options: [
        {
          name: "The name of the modification or option",
          description: "A description of the modification or option",
          impact_on_revenue: "The impact of the modification or option on revenue recognition"
        }
      ]
    },
    transaction_price: {
      pricing_available: "Read the contract text and answer by your understanding, What is the total transaction price for the contract? - Provide the total amount applicable on contract date, including any variable consideration.",
      total_transaction_price: {
        amount_applicable_on_contract_date_including_variable_considerations: "The total transaction price including variable considerations"
      },
      compensation_structure: {
        available_yes_no: "Read the contract text and answer by your understanding,Is the compensation structure available - Provide details on applicable fee structure: Fixed fee, lump sum, time and materials etc.",
        details: {
          name: "The name of the compensation structure",
          description: "A description of the compensation structure"
        }
      },
      variable_considerations: {
        available_yes_no: "Read the contract text and answer by your understanding, Does the contract include variable consideration (e.g., discounts, rebates, performance bonuses, penalties)? - If yes: Describe the nature and how it is estimated.",
        nature: [
          {
            name: "The name of the variable consideration",
            amount: "The amount of the variable consideration",
            estimation: "How the variable consideration is estimated"
          }
        ]
      },
      financing_components_non_cash_considerations_payable_amt_to_client: {
        yes_no: "Read the contract text and answer by your understanding, Are there any significant financing components, non-cash considerations, or payable amounts to clients within the contract? - If yes: Detail how these will be considered in revenue recognition.",
        details: [
          {
            name: "The name of the financing component or consideration",
            considerations: "How the financing component or consideration is considered in revenue recognition"
          }
        ]
      }
    },
    other_costs_associated_with_delivery: {
      yes_no: "Read the contract text and answer by your understanding, Other costs associated with delivery of these services. Travel expenses, overheads included in a contract fee?  - Provide details",
      details: [
        {
          cost: "The name of the cost",
          amount: "The amount of the cost",
          description: "A description of the cost"
        }
      ]
    },
    reimbursable_expenses_billed_to_client_separately: {
      available_yes_no: "Read the contract text and answer by your understanding, Other project reimbursable expenses which can be billed to the client separately. - If yes: provide details",
      details: {
        expense: "The name of the reimbursable expense",
        amount: "The amount of the reimbursable expense",
        description: "A description of the reimbursable expense"
      }
    },
    non_recoverable_costs: {
      yes_no: "Read the contract text and answer by your understanding, Other potential non recoverable costs. E.g.Demobilisation - If yes: provide details",
      details: [
        {
          name: "The name of the non-recoverable cost",
          amount: "The amount of the non-recoverable cost",
          description: "A description of the non-recoverable cost"
        }
      ]
    },
    calculation_of_price_allocation_for_POs: {
      method_used: "Read the contract text and answer by your understanding, How is the transaction price allocated among the performance obligations? - Describe the method used (e.g., relative standalone selling prices).",
      description: "Read the contract text and answer by your understanding, Describe the method used."
    },
    standalone_prices_for_each_obligation: {
      yes_no: "Read the contract text and answer by your understanding, Are standalone selling prices available for each performance obligation? - If no: Describe the estimation method used.",
      method_used_for_estimation: "The method used for estimating standalone selling prices",
      description: "A description of the estimation method"
    },
    discounts_variable_considerations_specific_to_obligations: {
      yes_no: "Read the contract text and answer by your understanding, Does any discount or variable consideration apply specifically to one or more performance obligations?  - If yes: Specify how it impacts allocation.",
      impact_on_allocation: "The impact of discounts or variable considerations on allocation"
    },
    milestones_or_kpiS: {
      available_yes_no: "Read the contract text and answer by your understanding, Are there milestones or KPIs applicable to the contract?  - provide details how performance in measured",
      details: {
        how_measured_performance: "How performance is measured in terms of milestones or KPIs"
      }
    },
    financial_terms: {
      payment_terms: [
        {
          name: "The name of the payment term",
          description: "A description of the payment term"
        }
      ],
      revenue_recognition_overtime_or_pointintime: {
        basis: "Read the contract text and answer by your understanding, Read the contract text and answer if the revenue is recognized over time or at a point in time. If overtime, provide the basis .",
        description: "A description of the revenue recognition basis"
      },
      for_PO_recognition_overtime_method_used_for_measuring_progress: {
        "Input/Output Method": "Read the contract text and answer by your understanding, For performance obligations recognized over time, what method is used to measure progress? (Input/Output method)",
        basis_of_selecting_the_method: "Read the contract text and answer by your understanding, and for performance obligations recognized over time, what method is used to measure progress? Provide the basis of selecting the model."
      },
      key_financial_obligations: [
        {
          payment_withholding: "The amount or percentage of payment withholding",
          payment_withholding_condition: "The condition for payment withholding"
        }
      ]
    }
  };
  
  
  