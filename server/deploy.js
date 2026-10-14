/**
 * Deploy AshvaTrace to Cloud Run using Cloud Build.
 * Usage: node deploy.js
 * Requires: ashvatrace-42607ad03e01.json in project root
 */
const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");
const path = require("path");

const PROJECT_ID = "ashvatrace";
const REGION = "us-central1";
const SERVICE_NAME = "ashvatrace";
const KEY_FILE = path.join(__dirname, "..", "ashvatrace-42607ad03e01.json");
const REPO = "akanthed/AshvaTrace";
const BRANCH = "master";

async function main() {
  const fs = require("fs");
  const key = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  const auth = new GoogleAuth({
    credentials: key,
    scopes: [
      "https://www.googleapis.com/auth/cloudplatform",
      "https://www.googleapis.com/auth/cloud.run",
      "https://www.googleapis.com/auth/cloud.build",
    ],
  });

  // Step 1: Trigger Cloud Build to build the Docker image
  console.log("1. Triggering Cloud Build...");
  const cloudbuild = google.cloudbuild({ version: "v1", auth });

  const build = {
    source: {
      repoSource: {
        repoId: REPO,
        revision: BRANCH,
      },
    },
    steps: [
      {
        name: "gcr.io/cloud-builders/docker",
        args: ["build", "-t", `gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest`, "-f", "Dockerfile", "."],
      },
      {
        name: "gcr.io/cloud-builders/docker",
        args: ["push", `gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest`],
      },
    ],
    images: [`gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest`],
  };

  const buildRes = await cloudbuild.projects.builds.create({
    projectId: PROJECT_ID,
    requestBody: build,
  });
  const buildId = buildRes.data.id;
  console.log(`   Build started: ${buildId}`);

  // Step 2: Wait for build to complete
  console.log("2. Waiting for build to complete...");
  let buildStatus;
  while (true) {
    await new Promise((r) => setTimeout(r, 10000));
    const status = await cloudbuild.projects.builds.get({
      projectId: PROJECT_ID,
      id: buildId,
    });
    buildStatus = status.data.status;
    console.log(`   Status: ${buildStatus}`);
    if (buildStatus === "SUCCESS") break;
    if (buildStatus === "FAILURE" || buildStatus === "ERROR") {
      console.error("Build failed!");
      console.error(JSON.stringify(status.data.errors, null, 2));
      process.exit(1);
    }
  }
  console.log("   Build succeeded!");

  // Step 3: Deploy to Cloud Run
  console.log("3. Deploying to Cloud Run...");
  const run = google.run({ version: "v1", auth });

  const service = {
    revisionTemplate: {
      spec: {
        containers: [
          {
            image: `gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest`,
            ports: [{ containerPort: 8080 }],
            env: [{ name: "PORT", value: "8080" }],
          },
        ],
      },
    },
  };

  const deployRes = await run.projects.locations.services.create({
    projectId: PROJECT_ID,
    location: REGION,
    serviceId: SERVICE_NAME,
    requestBody: service,
  });

  const url = deployRes.data.status?.url || `https://${SERVICE_NAME}-${PROJECT_ID}.a.run.app`;
  console.log(`4. Deployed! URL: ${url}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
