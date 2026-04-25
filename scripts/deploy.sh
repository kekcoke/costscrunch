#!/bin/bash
# ─── CostsCrunch Deployment Script ─────────────────────────────────────────────
# Deploys CDK stacks to AWS environments using context-based configuration.
#
# Usage:
#   ./scripts/deploy.sh <stage> [command]
#   ./scripts/deploy.sh dev deploy
#   ./scripts/deploy.sh staging synth
#   ./scripts/deploy.sh prod destroy
#
# Environment Variables:
#   CDK_DEFAULT_ACCOUNT  - AWS account (auto-detected from AWS config)
#   CDK_DEFAULT_REGION   - AWS region (default: us-east-1)
#   AWS_PROFILE          - Named AWS profile to use

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────────
STAGE="${1:-dev}"
COMMAND="${2:-deploy}"
REGION="${CDK_DEFAULT_REGION:-us-east-1}"

# Stage-specific account mapping (customize for your AWS org)
declare -A ACCOUNT_MAP=(
    ["dev"]="123456789012"
    ["staging"]="123456789012"
    ["prod"]="123456789012"
)

# ── Validation ──────────────────────────────────────────────────────────────────
valid_stages=("dev" "staging" "prod")
if [[ ! " ${valid_stages[*]} " =~ " ${STAGE} " ]]; then
    echo "❌ Invalid stage: $STAGE"
    echo "   Valid stages: ${valid_stages[*]}"
    exit 1
fi

valid_commands=("synth" "deploy" "diff" "destroy" "list")
if [[ ! " ${valid_commands[*]} " =~ " ${COMMAND} " ]]; then
    echo "❌ Invalid command: $COMMAND"
    echo "   Valid commands: ${valid_commands[*]}"
    exit 1
fi

# ── CDK Context Variables per Stage ────────────────────────────────────────────
# These values are passed as context to CDK and override cdk.json defaults.
declare -A CTX_CAPACITY_MODE=(
    ["dev"]="on-demand"
    ["staging"]="on-demand"
    ["prod"]="provisioned"
)

declare -A CTX_PROVISIONED_CONCURRENCY=(
    ["dev"]="false"
    ["staging"]="false"
    ["prod"]="true"
)

declare -A CTX_ERROR_RATE=(
    ["dev"]="5"
    ["staging"]="3"
    ["prod"]="1"
)

declare -A CTX_DURATION_P99=(
    ["dev"]="30000"
    ["staging"]="20000"
    ["prod"]="10000"
)

# ── Build CDK Command ───────────────────────────────────────────────────────────
STACK_NAME="costscrunch-${STAGE}"
ACCOUNT="${CDK_DEFAULT_ACCOUNT:-${ACCOUNT_MAP[$STAGE]}}"

CDK_CMD="cdk --app 'npx ts-node --project infrastructure/tsconfig.json infrastructure/bin/costscrunch.ts'"

# Context flags (pass as CLI args to override cdk.json)
CTX_FLAGS=(
    -c "stage=${STAGE}"
    -c "capacityMode=${CTX_CAPACITY_MODE[$STAGE]}"
    -c "provisionedConcurrency=${CTX_PROVISIONED_CONCURRENCY[$STAGE]}"
    -c "alarmThreshold.errorRate=${CTX_ERROR_RATE[$STAGE]}"
    -c "alarmThreshold.durationP99=${CTX_DURATION_P99[$STAGE]}"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 CostsCrunch Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Stage:        ${STAGE}"
echo "   Command:      ${COMMAND}"
echo "   Account:      ${ACCOUNT}"
echo "   Region:       ${REGION}"
echo "   Stack:        ${STACK_NAME}"
echo ""
echo "   Capacity Mode:        ${CTX_CAPACITY_MODE[$STAGE]}"
echo "   Provisioned Concurrency: ${CTX_PROVISIONED_CONCURRENCY[$STAGE]}"
echo "   Error Rate Threshold: ${CTX_ERROR_RATE[$STAGE]}%"
echo "   Duration P99 Threshold: ${CTX_DURATION_P99[$STAGE]}ms"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Execute CDK Command ─────────────────────────────────────────────────────────
cd "$(git rev-parse --show-toplevel)"

case "$COMMAND" in
    synth)
        echo "📋 Synthesizing CloudFormation template..."
        npx $CDK_CMD synth "${CTX_FLAGS[@]}" --quiet
        echo "✅ Template synthesized: cdk.out/${STACK_NAME}.template.json"
        ;;

    diff)
        echo "📊 Comparing deployed stack with template..."
        npx $CDK_CMD diff "${STACK_NAME}" "${CTX_FLAGS[@]}"
        ;;

    deploy)
        echo "🚀 Deploying stack..."
        npx $CDK_CMD deploy "${STAGE}-all" "${CTX_FLAGS[@]}" \
            --require-approval never \
            --ci
        echo ""
        echo "✅ Deployment complete!"
        echo "   Monitor: https://console.aws.amazon.com/cloudformation/home?region=${REGION}"
        ;;

    destroy)
        read -p "⚠️  This will delete ALL resources in ${STACK_NAME}. Continue? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "🗑️  Destroying stack..."
            npx $CDK_CMD destroy "${STACK_NAME}" "${CTX_FLAGS[@]}" --force
            echo "✅ Stack destroyed."
        else
            echo "❌ Aborted."
        fi
        ;;

    list)
        echo "📋 Available stacks:"
        npx $CDK_CMD list "${CTX_FLAGS[@]}"
        ;;
esac
