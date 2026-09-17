#!/usr/bin/env bash
# B.5.10 — Seed a PENDING approval step so the verify script can exercise
# Approver Mode. Creates (or leaves-in-place) one ApprovalInstance + one
# PENDING ApprovalStep on the WPT contract assigned to admin@demo.com.
#
# Safe to run repeatedly: looks up existing first.

set -e

CONTRACT_ID="cmn16g4xf001sdew25oas8dcy"     # WPT Enterprises — Zynga
ADMIN_ID="cmmxnzdze0008h3p3eiwcnmbk"          # admin@demo.com (WPT org)
ORG_ID="cmmxnzdsf0000h3p3gjy9qqs0"            # WPT org
WORKFLOW_ID="cmn3ay8vv000312mpufl69xzk"       # Standard (3-step)

PSQL="docker exec clm_postgres psql -U clm -d clm_dev -At -c"

existing=$($PSQL "SELECT id FROM approval_instances WHERE \"contractId\"='$CONTRACT_ID' AND status IN ('PENDING','ESCALATED') LIMIT 1;")

if [ -n "$existing" ]; then
  echo "Reusing existing approval instance $existing"
  INSTANCE_ID="$existing"
else
  INSTANCE_ID="b510_inst_$(date +%s)"
  echo "Creating approval instance $INSTANCE_ID"
  $PSQL "INSERT INTO approval_instances (
    id, \"orgId\", \"contractId\", \"workflowDefinitionId\", status,
    \"currentStepOrder\", \"submittedById\",
    \"aiSummary\", \"keyRisks\", \"approvalRecommendation\",
    \"submittedAt\", \"updatedAt\"
  ) VALUES (
    '$INSTANCE_ID', '$ORG_ID', '$CONTRACT_ID', '$WORKFLOW_ID', 'PENDING',
    0, '$ADMIN_ID',
    'Standard license agreement with 2-year term, 60-day termination notice, and mutual non-exclusivity. Overall terms align with our playbook.',
    '[{\"title\":\"Liability cap is 2x annual fees — non-standard\",\"description\":\"Our playbook requires 1x annual fees cap. 2x exposes us to materially higher downside.\",\"severity\":\"medium\"}]',
    'review_required',
    NOW(), NOW()
  );" > /dev/null
fi

existing_step=$($PSQL "SELECT id FROM approval_steps WHERE \"approvalInstanceId\"='$INSTANCE_ID' AND \"approverId\"='$ADMIN_ID' AND status='PENDING' LIMIT 1;")
if [ -n "$existing_step" ]; then
  echo "Reusing existing pending step $existing_step"
else
  STEP_ID="b510_step_$(date +%s)"
  echo "Creating pending step $STEP_ID"
  $PSQL "INSERT INTO approval_steps (
    id, \"approvalInstanceId\", \"orgId\", \"stepOrder\", \"stepName\",
    \"approverId\", status, \"createdAt\", \"updatedAt\"
  ) VALUES (
    '$STEP_ID', '$INSTANCE_ID', '$ORG_ID', 0, 'Legal Review',
    '$ADMIN_ID', 'PENDING', NOW(), NOW()
  );" > /dev/null
fi

# Make sure contract status reflects that it's in review
$PSQL "UPDATE contracts SET status='PENDING_APPROVAL' WHERE id='$CONTRACT_ID' AND status NOT IN ('APPROVED','EXECUTED');" > /dev/null

echo "B.5.10 seed OK — instance=$INSTANCE_ID"
