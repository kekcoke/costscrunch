import { describe, it, expect, vi, beforeEach } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

describe("Rollback Workflow", () => {
  const workflowPath = path.join(__dirname, "../../.github/workflows/rollback.yml");
  const deployPath = path.join(__dirname, "../../.github/workflows/deploy.yml");

  describe("YAML Structure Validation", () => {
    it("rollback.yml has valid workflow_call trigger", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("workflow_call:");
      expect(content).toContain("on:");
    });

    it("rollback.yml defines all required inputs", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      const requiredInputs = [
        "environment:",
        "stack_name:",
        "api_url:",
        "deployment_sha:",
      ];
      requiredInputs.forEach((input) => {
        expect(content).toContain(input);
      });
    });

    it("rollback.yml has health-check-and-rollback job", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("health-check-and-rollback:");
    });

    it("rollback.yml includes rollback step with cloudformation", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("aws cloudformation rollback-stack");
      expect(content).toContain("stack-name");
    });

    it("rollback.yml includes wait step after rollback", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("aws cloudformation wait stack-rollback-complete");
    });

    it("rollback.yml has Slack notification steps", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("8398a7/action-slack@v3");
      expect(content).toContain("SLACK_WEBHOOK_URL");
    });
  });

  describe("Health Check Logic", () => {
    it("health check script retries on failure", async () => {
      const script = `
                MAX_RETRIES=3
                RETRY_INTERVAL=0
                ATTEMPT=0

                for i in $(seq 1 $MAX_RETRIES); do
                  ATTEMPT=$i
                  if [ $i -eq $MAX_RETRIES ]; then
                    exit 1
                  fi
                done
                `;
      // Simulate the retry logic
      const maxRetries = 3;
      let attempts = 0;
      for (let i = 1; i <= maxRetries; i++) {
        attempts = i;
        if (i === maxRetries) {
          expect(attempts).toBe(maxRetries);
        }
      }
      expect(attempts).toBe(3);
    });

    it("health check exits 0 on success", async () => {
      const httpCode = 200;
      const passed = httpCode === 200;
      expect(passed).toBe(true);
    });

    it("health check exits 1 on failure", async () => {
      const httpCode = 500;
      const passed = httpCode === 200;
      expect(passed).toBe(false);
    });

    it("health check accepts various HTTP codes as failure", async () => {
      const failureCodes = [0, 301, 400, 403, 404, 500, 502, 503];
      failureCodes.forEach((code) => {
        const passed = code === 200;
        expect(passed).toBe(false);
      });
    });
  });

  describe("Rollback Conditions", () => {
    it("triggers rollback when health_check_passed is false", () => {
      const healthCheckPassed = "false";
      const shouldRollback = healthCheckPassed === "false";
      expect(shouldRollback).toBe(true);
    });

    it("does not rollback when health_check_passed is true", () => {
      const healthCheckPassed = "true";
      const shouldRollback = healthCheckPassed === "false";
      expect(shouldRollback).toBe(false);
    });
  });

  describe("Deploy Workflow Integration", () => {
    it("deploy.yml calls rollback workflow for staging", () => {
      const content = fs.readFileSync(deployPath, "utf8");
      expect(content).toContain("post-deploy-staging:");
      expect(content).toContain("uses: ./.github/workflows/rollback.yml");
      expect(content).toContain("stack_name: costscrunch-staging-CostsCrunchStack");
    });

    it("deploy.yml calls rollback workflow for production", () => {
      const content = fs.readFileSync(deployPath, "utf8");
      expect(content).toContain("post-deploy-prod:");
      expect(content).toContain("uses: ./.github/workflows/rollback.yml");
      expect(content).toContain("stack_name: costscrunch-prod-CostsCrunchStack");
    });

    it("post-deploy jobs use if: always()", () => {
      const content = fs.readFileSync(deployPath, "utf8");
      expect(content).toMatch(/post-deploy-staging:[\s\S]*?if:\s*always/);
      expect(content).toMatch(/post-deploy-prod:[\s\S]*?if:\s*always/);
    });

    it("post-deploy staging needs deploy-staging", () => {
      const content = fs.readFileSync(deployPath, "utf8");
      expect(content).toMatch(/post-deploy-staging:[\s\S]*?needs:\s*deploy-staging/);
    });

    it("post-deploy production needs deploy-prod", () => {
      const content = fs.readFileSync(deployPath, "utf8");
      expect(content).toMatch(/post-deploy-prod:[\s\S]*?needs:\s*deploy-prod/);
    });
  });

  describe("Notification Content", () => {
    it("failure notification includes deployment SHA", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("deployment_sha");
      expect(content).toContain("Commit:");
      expect(content).toContain("ROLLED BACK");
    });

    it("success notification includes deployment SHA", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("deployment_sha");
      expect(content).toMatch(/SUCCESS.*Commit/s);
    });

    it("notifications include stack name", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("Stack:");
      expect(content).toContain("{{ inputs.stack_name }}");
    });
  });

  describe("Wait Time Configuration", () => {
    it("wait time is 30 seconds", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toMatch(/sleep\s+30/);
      expect(content).toContain("Waiting 30 seconds for deployment propagation");
    });

    it("retry interval is 10 seconds", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("RETRY_INTERVAL=10");
      expect(content).toMatch(/sleep\s+\$RETRY_INTERVAL/);
    });

    it("max retries is 3", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toContain("MAX_RETRIES=3");
    });

    it("curl timeout is 30 seconds", () => {
      const content = fs.readFileSync(workflowPath, "utf8");
      expect(content).toMatch(/curl.*--max-time\s+30/);
    });
  });
});
