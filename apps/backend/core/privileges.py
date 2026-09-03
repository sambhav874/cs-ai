"""The privileges a person can hold, and the bundles we ship.

A privilege is the only thing an authorization check ever asks for. Nothing in
this codebase branches on a persona's name: personas are data an account owner
edits, so a name is not something the code can rely on.

Privilege strings are shaped so a scope can be appended later —
``contract.approve@project:<id>`` — without migrating what is already stored.
Scope is not implemented.
"""

from typing import Dict, List

# --- Contracts ---------------------------------------------------------------
CONTRACT_READ = "contract.read"
CONTRACT_UPLOAD = "contract.upload"
CONTRACT_EDIT = "contract.edit"
CONTRACT_SUBMIT = "contract.submit"
CONTRACT_APPROVE = "contract.approve"
CONTRACT_DELETE = "contract.delete"

# --- Workflow roles ----------------------------------------------------------
ROLES_ASSIGN_PROJECT = "roles.assign.project"
ROLES_ASSIGN_CONTRACT = "roles.assign.contract"
ROLES_DELEGATE = "roles.delegate"

# --- KPIs --------------------------------------------------------------------
KPI_READ = "kpi.read"
KPI_EDIT = "kpi.edit"
KPI_CERTIFY = "kpi.certify"
KPI_ALERTS = "kpi.alerts"

# --- Account -----------------------------------------------------------------
ACCOUNT_MEMBERS = "account.members"
ACCOUNT_BILLING = "account.billing"
ACCOUNT_PERSONAS = "account.personas"
AUDIT_READ = "audit.read"


ALL_PRIVILEGES: List[str] = [
    CONTRACT_READ, CONTRACT_UPLOAD, CONTRACT_EDIT, CONTRACT_SUBMIT,
    CONTRACT_APPROVE, CONTRACT_DELETE,
    ROLES_ASSIGN_PROJECT, ROLES_ASSIGN_CONTRACT, ROLES_DELEGATE,
    KPI_READ, KPI_EDIT, KPI_CERTIFY, KPI_ALERTS,
    ACCOUNT_MEMBERS, ACCOUNT_BILLING, ACCOUNT_PERSONAS, AUDIT_READ,
]

# Shown in the persona editor, so the wording is the account owner's, not the
# schema's.
PRIVILEGE_LABELS: Dict[str, str] = {
    CONTRACT_READ: "Read contracts",
    CONTRACT_UPLOAD: "Upload contracts",
    CONTRACT_EDIT: "Edit contract content",
    CONTRACT_SUBMIT: "Submit for approval",
    CONTRACT_APPROVE: "Approve and reject contracts",
    CONTRACT_DELETE: "Delete contracts",
    ROLES_ASSIGN_PROJECT: "Set a project's default roles",
    ROLES_ASSIGN_CONTRACT: "Override roles on one contract",
    ROLES_DELEGATE: "Hand your role to a colleague",
    KPI_READ: "Read KPIs",
    KPI_EDIT: "Create and edit KPIs",
    KPI_CERTIFY: "Certify KPIs",
    KPI_ALERTS: "Manage alerts and recoveries",
    ACCOUNT_MEMBERS: "Add and remove members",
    ACCOUNT_BILLING: "Billing and credits",
    ACCOUNT_PERSONAS: "Create and edit personas",
    AUDIT_READ: "Read the audit trail",
}

# Personas an account starts with. Every one of them is editable, and an account
# can clone any into something of its own — these are a starting point, not a
# taxonomy.
DEFAULT_PERSONAS: Dict[str, List[str]] = {
    "Owner": list(ALL_PRIVILEGES),
    "Contract manager": [
        CONTRACT_READ, CONTRACT_UPLOAD, CONTRACT_EDIT, CONTRACT_SUBMIT,
        ROLES_ASSIGN_PROJECT, ROLES_ASSIGN_CONTRACT, ROLES_DELEGATE,
        KPI_READ, KPI_EDIT, KPI_ALERTS, AUDIT_READ,
    ],
    "Approver": [
        CONTRACT_READ, CONTRACT_UPLOAD, CONTRACT_EDIT, CONTRACT_SUBMIT,
        CONTRACT_APPROVE, ROLES_ASSIGN_CONTRACT, ROLES_DELEGATE,
        KPI_READ, KPI_EDIT, AUDIT_READ,
    ],
    # Real authority over the numbers, none over the language. This is the split
    # ISO 27001 asks for between requesting, approving and implementing.
    "Finance": [
        CONTRACT_READ, KPI_READ, KPI_EDIT, KPI_CERTIFY, KPI_ALERTS,
        ROLES_DELEGATE, AUDIT_READ,
    ],
    "Viewer": [CONTRACT_READ, KPI_READ],
}

# What an existing member becomes when personas are first seeded, so that
# turning this on changes nobody's access.
TEAM_ROLE_TO_PERSONA: Dict[str, str] = {
    "admin": "Owner",
    "member": "Contract manager",
}

# A person holding a workflow role has to be able to exercise it.
ROLE_PRIVILEGE_REQUIRED: Dict[str, str] = {
    "editor": CONTRACT_EDIT,
    "approver": CONTRACT_APPROVE,
    "admin": ROLES_ASSIGN_PROJECT,
}
