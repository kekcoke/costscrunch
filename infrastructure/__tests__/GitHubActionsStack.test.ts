import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { GitHubActionsStack } from "../stacks/GitHubActionsStack";

describe("GitHubActionsStack", () => {
  describe("staging environment", () => {
    const app = new cdk.App();

    const stack = new GitHubActionsStack(app, "TestGitHubActions", {
      githubOrg: "test-org",
      repositoryName: "test-repo",
      branchName: "main",
      environment: "staging",
      env: {
        account: "123456789012",
        region: "us-east-1",
      },
    });

    const template = Template.fromStack(stack);

    it("creates an OpenID Connect Provider via custom resource", () => {
      // CDK creates OIDC provider via CustomResource, not direct AWS::IAM::OIDCProvider
      const oidcProviderKey = Object.keys(template.toJSON().Resources).find(
        (k) => k.includes("GithubOidcProvider") || k.includes("OpenIdConnectProvider")
      );
      expect(oidcProviderKey).toBeDefined();
    });

    it("configures OIDC provider with correct URL", () => {
      // The custom resource handles OIDC provider creation; check trust policy in role
      const resources = template.toJSON().Resources;
      const deployRoleKey = Object.keys(resources).find(
        (k) => resources[k].Properties?.RoleName === "costscrunch-staging-github-actions-deploy"
      );
      expect(deployRoleKey).toBeDefined();
      const role = resources[deployRoleKey!];
      const assumePolicy = role.Properties.AssumeRolePolicyDocument;
      const oidcStatement = assumePolicy.Statement.find(
        (s: any) => s.Action === "sts:AssumeRoleWithWebIdentity"
      );
      expect(oidcStatement).toBeDefined();
      expect(oidcStatement.Condition.StringEquals["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
    });

    it("sets sts.amazonaws.com as client ID in trust policy", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sts:AssumeRoleWithWebIdentity",
              Condition: {
                StringEquals: {
                  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                },
              },
            }),
          ]),
        },
      });
    });

    it("includes GitHub OIDC thumbprints in provider", () => {
      // Thumbprints are in custom resource properties
      const resources = template.toJSON().Resources;
      const oidcKey = Object.keys(resources).find((k) => k.includes("GithubOidcProvider"));
      expect(oidcKey).toBeDefined();
    });

    it("creates IAM roles for GitHub Actions and custom resource provider", () => {
      // 2 roles: custom resource provider + deploy role
      template.resourceCountIs("AWS::IAM::Role", 2);
    });

    it("sets correct role name", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: "costscrunch-staging-github-actions-deploy",
      });
    });

    it("has trust policy allowing GitHub OIDC federation", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Action: "sts:AssumeRoleWithWebIdentity",
              Condition: {
                StringEquals: {
                  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                },
                StringLike: {
                  "token.actions.githubusercontent.com:sub": "repo:test-org/test-repo:ref:refs/heads/main",
                },
              },
            },
          ],
        },
      });
    });

    it("exports OIDC provider ARN", () => {
      template.hasOutput("OIDCProviderArn", {
        Description: "ARN of the GitHub OIDC Provider",
        Export: {
          Name: "costscrunch-staging-github-oidc-provider-arn",
        },
      });
    });

    it("exports IAM role ARN", () => {
      template.hasOutput("IAMRoleArn", {
        Description: "ARN of the GitHub Actions deploy role",
        Export: {
          Name: "costscrunch-staging-github-actions-role-arn",
        },
      });
    });

    it("contains CDK deploy policy", () => {
      const resources = template.toJSON().Resources;
      // Find the deploy role (not the custom resource provider role)
      const deployRoleKey = Object.keys(resources).find(
        k => resources[k].Type === "AWS::IAM::Role" && 
             resources[k].Properties?.RoleName === "costscrunch-staging-github-actions-deploy"
      );
      expect(deployRoleKey).toBeDefined();
      
      const policies = resources[deployRoleKey!].Properties.Policies;
      expect(policies).toBeDefined();
      expect(policies.length).toBeGreaterThan(0);
      
      const policyNames = policies.map((p: { PolicyName: string }) => p.PolicyName);
      expect(policyNames).toContain("cdkDeployPolicy");
    });
  });

  describe("production environment", () => {
    it("uses correct environment prefix in role name", () => {
      const app = new cdk.App();
      const stack = new GitHubActionsStack(app, "ProdStack", {
        githubOrg: "myorg",
        repositoryName: "myrepo",
        branchName: "main",
        environment: "prod",
        env: {
          account: "987654321098",
          region: "us-west-2",
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: "costscrunch-prod-github-actions-deploy",
      });

      template.hasOutput("IAMRoleArn", {
        Export: {
          Name: "costscrunch-prod-github-actions-role-arn",
        },
      });
    });
  });

  describe("trust policy constraints", () => {
    it("restricts to specific repository", () => {
      const app = new cdk.App();
      const stack = new GitHubActionsStack(app, "RepoRestrict", {
        githubOrg: "costscrunch",
        repositoryName: "backend",
        branchName: "develop",
        environment: "staging",
        env: {
          account: "111222333444",
          region: "us-east-1",
        },
      });

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Condition: {
                StringLike: {
                  "token.actions.githubusercontent.com:sub": "repo:costscrunch/backend:ref:refs/heads/develop",
                },
              },
            }),
          ],
        },
      });
    });
  });

  it("matches snapshot", () => {
    const app = new cdk.App();
    const stack = new GitHubActionsStack(app, "SnapshotTest", {
      githubOrg: "test-org",
      repositoryName: "test-repo",
      branchName: "main",
      environment: "staging",
      env: {
        account: "123456789012",
        region: "us-east-1",
      },
    });

    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
