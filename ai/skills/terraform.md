# CostsCrunch — terraform.md
## Terraform Skill: Standalone HCL + CDK→Terraform Migration Guide

> Two-part skill. Part 1 covers standalone Terraform patterns for AWS serverless projects.
> Part 2 maps this project's CDK v2 constructs to equivalent Terraform HCL.

---

## Part 1 — Standalone Terraform (HCL / AWS)

### 1.1 Provider & Version Setup

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "costscrunch-tfstate-<account-id>"
    key            = "<env>/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "costscrunch-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "costscrunch"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

### 1.2 Remote State Bootstrap (run once per account)

```hcl
# bootstrap/main.tf — creates state bucket and lock table
resource "aws_s3_bucket" "tfstate" {
  bucket = "costscrunch-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "costscrunch-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}

data "aws_caller_identity" "current" {}
```

### 1.3 Environment Isolation

Prefer **separate state files per environment** over workspaces for strong prod isolation:

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf           # calls modules, dev-specific values
│   │   ├── terraform.tfvars  # dev var values (not secrets)
│   │   └── backend.tf        # key = "dev/terraform.tfstate"
│   ├── staging/
│   │   └── ...
│   └── prod/
│       └── ...               # requires separate IAM role assumption
└── modules/
    ├── lambda/
    ├── api-gateway/
    ├── dynamodb/
    ├── cognito/
    └── networking/
```

### 1.4 Module Structure (Serverless)

```hcl
# modules/lambda/main.tf
variable "function_name"    {}
variable "handler"          { default = "index.handler" }
variable "runtime"          { default = "nodejs20.x" }
variable "memory_size"      { default = 1024 }
variable "timeout"          { default = 29 }
variable "environment_vars" { type = map(string); default = {} }
variable "role_arn"         {}
variable "source_dir"       {}   # path to built Lambda dist

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/.build/${var.function_name}.zip"
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  role             = var.role_arn
  handler          = var.handler
  runtime          = var.runtime
  memory_size      = var.memory_size
  timeout          = var.timeout

  environment {
    variables = var.environment_vars
  }

  tracing_config {
    mode = "Active"   # X-Ray
  }
}

output "function_arn"  { value = aws_lambda_function.this.arn }
output "function_name" { value = aws_lambda_function.this.function_name }
output "invoke_arn"    { value = aws_lambda_function.this.invoke_arn }
```

### 1.5 Variable & Secret Management

```hcl
# variables.tf
variable "environment"  { type = string }
variable "aws_region"   { type = string; default = "us-east-1" }

# NEVER put secrets here — use SSM data sources instead
data "aws_ssm_parameter" "bedrock_model_id" {
  name            = "/costscrunch-${var.environment}/bedrock-model-id"
  with_decryption = true
}

# Reference in Lambda env:
environment_vars = {
  BEDROCK_MODEL_ID = data.aws_ssm_parameter.bedrock_model_id.value
}
```

- Never commit `.tfvars` files containing secrets
- Mark sensitive outputs with `sensitive = true`
- Use `TF_VAR_*` environment variables in CI for secret injection

### 1.6 Plan / Apply Workflow

```bash
# Standard workflow
terraform init
terraform validate
terraform plan -out=tfplan -var-file=environments/staging/terraform.tfvars
# Human reviews tfplan output
terraform apply tfplan

# Drift detection in CI (non-zero exit if drift)
terraform plan -detailed-exitcode -var-file=environments/prod/terraform.tfvars

# Import existing resource (when migrating from CDK)
terraform import aws_dynamodb_table.main costscrunch-prod-main
terraform import aws_lambda_function.expenses costscrunch-prod-expenses
```

### 1.7 State Management Safety Rules

- Always use `lifecycle { prevent_destroy = true }` on DynamoDB tables, S3 buckets, and Cognito user pools in prod
- Enable state locking (`dynamodb_table` in backend config) — prevents concurrent applies
- Before `terraform destroy`, run `terraform state list` and confirm what will be removed
- Backup state: `terraform state pull > backup-$(date +%Y%m%d).tfstate`

---

## Part 2 — CDK→Terraform Migration (CostsCrunch-Specific)

### 2.1 Construct Mapping Table

| CDK Construct | Terraform Resource(s) |
|---------------|----------------------|
| `aws_cdk.aws_lambda.Function` | `aws_lambda_function` + `aws_lambda_permission` (per trigger) |
| `aws_cdk.aws_dynamodb.Table` (with GSIs) | `aws_dynamodb_table` with `global_secondary_index` blocks |
| `aws_cdk.aws_apigatewayv2.HttpApi` | `aws_apigatewayv2_api` + `aws_apigatewayv2_stage` + `aws_apigatewayv2_route` |
| `aws_cdk.aws_apigateway.RestApi` | `aws_api_gateway_rest_api` + `aws_api_gateway_resource` + `aws_api_gateway_method` |
| `aws_cdk.aws_s3.Bucket` (KMS encrypted) | `aws_s3_bucket` + `aws_s3_bucket_server_side_encryption_configuration` + `aws_s3_bucket_versioning` + `aws_s3_bucket_cors_configuration` |
| `aws_cdk.aws_cognito.UserPool` | `aws_cognito_user_pool` + `aws_cognito_user_pool_client` + `aws_cognito_user_pool_domain` |
| `aws_cdk.aws_elasticache.ReplicationGroup` | `aws_elasticache_replication_group` + `aws_elasticache_subnet_group` |
| `aws_cdk.aws_wafv2.CfnWebACL` | `aws_wafv2_web_acl` + `aws_wafv2_web_acl_association` |
| `aws_cdk.aws_cloudfront.Distribution` | `aws_cloudfront_distribution` + `aws_cloudfront_origin_access_identity` |
| `aws_cdk.aws_events.EventBus` | `aws_cloudwatch_event_bus` + `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target` |
| `aws_cdk.aws_sqs.Queue` (FIFO) | `aws_sqs_queue` (with `fifo_queue = true`, `content_based_deduplication = true`) |
| `aws_cdk.aws_sns.Topic` | `aws_sns_topic` + `aws_sns_topic_subscription` |
| `aws_cdk.aws_kms.Key` (auto-rotate) | `aws_kms_key` (with `enable_key_rotation = true`) + `aws_kms_alias` |
| `aws_cdk.aws_ssm.StringParameter` | `aws_ssm_parameter` |
| `aws_cdk.aws_secretsmanager.Secret` | `aws_secretsmanager_secret` + `aws_secretsmanager_secret_version` |
| `aws_cdk.aws_ec2.Vpc` | `aws_vpc` + `aws_subnet` + `aws_internet_gateway` + `aws_route_table` |
| `aws_cdk.aws_ec2.SecurityGroup` | `aws_security_group` + `aws_security_group_rule` |
| `aws_cdk.aws_iam.Role` | `aws_iam_role` + `aws_iam_role_policy` (or `aws_iam_role_policy_attachment`) |
| `aws_cdk.aws_ses.EmailIdentity` | `aws_ses_email_identity` or `aws_ses_domain_identity` |
| CDK IAspect (secret guard) | Sentinel / OPA policy — check `aws_lambda_function.environment` for sensitive keys |

### 2.2 DynamoDB Table with GSIs (CostsCrunch Main Table)

```hcl
resource "aws_dynamodb_table" "main" {
  name         = "costscrunch-${var.environment}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute { name = "pk";      type = "S" }
  attribute { name = "sk";      type = "S" }
  attribute { name = "gsi1pk";  type = "S" }
  attribute { name = "gsi1sk";  type = "S" }
  attribute { name = "gsi2pk";  type = "S" }
  attribute { name = "gsi2sk";  type = "S" }
  attribute { name = "gsi3pk";  type = "S" }
  attribute { name = "gsi3sk";  type = "S" }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "gsi2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "ReceiptHashIndex"
    hash_key        = "gsi3pk"
    range_key       = "gsi3sk"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = var.environment == "prod"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb.arn
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  lifecycle {
    prevent_destroy = true   # CRITICAL: never destroy the prod table
  }
}
```

### 2.3 Migration Order

Migrate in dependency order to avoid circular references:

1. **IAM + KMS** — no dependencies; all other resources reference these
2. **Networking** — VPC, subnets, security groups (Redis, Lambda need these)
3. **Storage** — DynamoDB table, S3 buckets (Lambda references bucket ARNs)
4. **Cognito** — User Pool + Client (auth Lambda needs pool ID)
5. **Messaging** — SNS topics, SQS queues, EventBridge bus
6. **Compute** — Lambda functions (reference all of the above)
7. **API layer** — API Gateway HTTP v2, routes, authorizer
8. **Cache** — ElastiCache Redis (references VPC/SG from step 2)
9. **Edge** — CloudFront distribution, WAF web ACL

### 2.4 State Import Commands (Live Resources)

When migrating a live CDK-deployed stack to Terraform, import existing resources:

```bash
# Import existing DynamoDB table
terraform import aws_dynamodb_table.main costscrunch-prod-main

# Import Lambda functions (repeat for each)
terraform import aws_lambda_function.expenses costscrunch-prod-expenses
terraform import aws_lambda_function.groups   costscrunch-prod-groups
terraform import aws_lambda_function.auth     costscrunch-prod-auth

# Import S3 buckets
terraform import aws_s3_bucket.assets costscrunch-prod-assets-<account-id>

# Import Cognito user pool (get ID from AWS console or aws cognito-idp list-user-pools)
terraform import aws_cognito_user_pool.main <user-pool-id>

# Import API Gateway
terraform import aws_apigatewayv2_api.main <api-id>
```

### 2.5 Critical Migration Risks

| Risk | CDK behavior | Terraform behavior | Mitigation |
|------|-------------|-------------------|------------|
| **DynamoDB GSI changes** | CloudFormation handles in-place via update | Terraform requires table replacement | Use `lifecycle { ignore_changes = [global_secondary_index] }` for existing GSIs; add new GSIs only |
| **Cognito user pool deletion** | CloudFormation respects `RemovalPolicy.RETAIN` | `terraform destroy` will delete user pool and all users | Always `lifecycle { prevent_destroy = true }` |
| **KMS key deletion** | CDK sets 7-day pending deletion | Terraform deletes immediately | Set `deletion_window_in_days = 30` on `aws_kms_key` |
| **IASpect secret guard** | CDK synthesis fails if secret in Lambda env | No equivalent by default | Add Sentinel/OPA policy or use `precondition` in Terraform |
| **CDK logical IDs** | Resources named by CDK construct ID | Terraform names are explicit | Use `terraform import` to link existing resources; avoid recreation |

### 2.6 CDK IAspect Secret Guard Equivalent

The project uses a CDK IAspect that fails synthesis if a Lambda env var looks like a secret. In Terraform, enforce this with a `precondition`:

```hcl
resource "aws_lambda_function" "expenses" {
  # ...
  environment {
    variables = var.expenses_env_vars
  }

  lifecycle {
    precondition {
      condition = !anytrue([
        for k, v in var.expenses_env_vars :
        can(regex("(?i)(password|secret|token|key|credential)", k))
      ])
      error_message = "Lambda env vars must not contain secrets. Use SSM Parameter Store."
    }
  }
}
```

---

## Part 3 — Terraform in CI/CD (GitHub Actions)

```yaml
name: Terraform Plan

on:
  pull_request:
    paths:
      - 'terraform/**'

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      id-token: write      # OIDC
      contents: read
      pull-requests: write # post plan as PR comment

    steps:
      - uses: actions/checkout@<pin-to-sha>

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@<pin-to-sha>
        with:
          role-to-assume: ${{ vars.STAGING_GITHUB_ROLE_ARN }}
          aws-region: us-east-1

      - uses: hashicorp/setup-terraform@<pin-to-sha>
        with:
          terraform_version: "1.6.6"

      - run: terraform init
        working-directory: terraform/environments/staging

      - run: terraform plan -no-color -out=tfplan
        working-directory: terraform/environments/staging

      - name: Post plan to PR
        uses: actions/github-script@<pin-to-sha>
        # ... post plan output as PR comment
```
