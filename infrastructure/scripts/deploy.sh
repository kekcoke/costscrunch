#!/bin/bash
# ─── CostsCrunch Deployment Script ────────────────────────────────────────────
# Deploys CostsCrunch infrastructure to AWS environments
#
# Usage:
#   ./scripts/deploy.sh dev       # Deploy to dev environment
#   ./scripts/deploy.sh staging   # Deploy to staging environment
#   ./scripts/deploy.sh prod      # Deploy to production environment
#   ./scripts/deploy.sh synth     # Synthesize CloudFormation templates
#   ./scripts/deploy.sh list      # List available environments

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
CDK_COMMAND="${CDK_COMMAND:-cdk}"

# Stage configurations
declare -A STAGE_CONFIG=(
    ["dev"]="on-demand:false:destroy"
    ["staging"]="on-demand:false:destroy"
    ["prod"]="provisioned:true:retain"
)

# ── Helper Functions ───────────────────────────────────────────────────────────
log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    exit 1
}

check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &>/dev/null; then
        error "AWS credentials not configured. Run 'aws configure' or set AWS environment variables."
    fi
    
    # Check CDK
    if ! command -v cdk &>/dev/null && ! npx cdk --version &>/dev/null; then
        error "CDK not installed. Run 'npm install -g aws-cdk'."
    fi
    
    # Check Node.js
    if ! command -v node &>/dev/null; then
        error "Node.js not installed."
    fi
    
    success "Prerequisites check passed"
}

bootstrap_if_needed() {
    local stage=$1
    local account="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
    local region="${AWS_REGION:-us-east-1}"
    
    log "Checking CDK bootstrap for $stage (account: $account, region: $region)..."
    
    if ! aws cloudformation describe-stacks \
        --stack-name "CDKToolkit" \
        --region "$region" &>/dev/null; then
        log "CDK not bootstrapped in $region. Bootstrapping..."
        npx cdk bootstrap "aws://$account/$region" --toolkit-stack-name CDKToolkit
        success "Bootstrap complete"
    else
        log "CDK already bootstrapped"
    fi
}

# ── Deployment Commands ────────────────────────────────────────────────────────
synthesize() {
    log "Synthesizing CloudFormation templates..."
    cd "$INFRA_DIR"
    npm run synth
    success "Templates synthesized to infrastructure/cdk.out/"
}

deploy_stage() {
    local stage=$1
    local config=(${STAGE_CONFIG[$stage]//:/ })
    local capacity_mode=${config[0]}
    local provisioned=${config[1]}
    local removal_policy=${config[2]}
    
    log "Deploying to ${stage}..."
    log "  Capacity Mode: $capacity_mode"
    log "  Provisioned Concurrency: $provisioned"
    log "  Removal Policy: $removal_policy"
    
    # Bootstrap if needed
    bootstrap_if_needed "$stage"
    
    # Deploy
    cd "$INFRA_DIR"
    npx cdk deploy "costscrunch-${stage}" \
        --require-approval never \
        --context stage="$stage" \
        --context capacityMode="$capacity_mode" \
        --context provisionedConcurrency="$provisioned" \
        --context removalPolicy="$removal_policy"
    
    success "Deployed to ${stage}"
}

destroy_stage() {
    local stage=$1
    
    warn "Destroying ${stage} stack..."
    warn "This will DELETE all resources in the ${stage} environment!"
    
    read -p "Are you sure? Type '${stage}' to confirm: " confirm
    if [ "$confirm" != "$stage" ]; then
        error "Destruction cancelled"
    fi
    
    cd "$INFRA_DIR"
    npx cdk destroy "costscrunch-${stage}" --force
    
    success "Destroyed ${stage}"
}

list_environments() {
    echo ""
    echo "Available environments:"
    echo ""
    printf "  %-12s %-15s %-20s %s\n" "STAGE" "CAPACITY" "PROV CONCURRENCY" "REMOVAL POLICY"
    printf "  %-12s %-15s %-20s %s\n" "------" "--------" "----------------" "--------------"
    for stage in dev staging prod; do
        local config=(${STAGE_CONFIG[$stage]//:/ })
        printf "  %-12s %-15s %-20s %s\n" \
            "$stage" \
            "${config[0]}" \
            "${config[1]}" \
            "${config[2]}"
    done
    echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────────
main() {
    local command=${1:-help}
    local stage=${2:-}
    
    case "$command" in
        dev|staging|prod)
            check_prerequisites
            deploy_stage "$command"
            ;;
        synth|synthesize)
            check_prerequisites
            synthesize
            ;;
        destroy)
            if [ -z "$stage" ]; then
                error "Usage: $0 destroy <dev|staging|prod>"
            fi
            check_prerequisites
            destroy_stage "$stage"
            ;;
        bootstrap)
            check_prerequisites
            bootstrap_if_needed "${stage:-dev}"
            ;;
        list)
            list_environments
            ;;
        help|--help|-h)
            echo "CostsCrunch Deployment Script"
            echo ""
            echo "Usage: $0 <command> [options]"
            echo ""
            echo "Commands:"
            echo "  dev       Deploy to dev environment"
            echo "  staging   Deploy to staging environment"
            echo "  prod      Deploy to production environment"
            echo "  synth     Synthesize CloudFormation templates"
            echo "  destroy <env>   Destroy environment (requires confirmation)"
            echo "  bootstrap [env] Bootstrap CDK in environment"
            echo "  list      List available environments"
            echo "  help      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 dev                  # Deploy to dev"
            echo "  $0 staging              # Deploy to staging"
            echo "  $0 prod                 # Deploy to production"
            echo "  $0 synth                # Generate CloudFormation templates"
            echo "  $0 destroy dev          # Destroy dev (with confirmation)"
            echo ""
            ;;
        *)
            error "Unknown command: $command. Run '$0 help' for usage."
            ;;
    esac
}

main "$@"
