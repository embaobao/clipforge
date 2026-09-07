import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} not found`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Onboarding surface verification failed: ${message}`);
    process.exitCode = 1;
  }
}

const app = read("src/onboarding/OnboardingApp.tsx");

assert(
  app.includes('data-surface="onboarding"'),
  "standalone onboarding root should keep a stable surface marker",
);
assert(
  app.includes("h-dvh") || app.includes("min-h-dvh"),
  "standalone shell should be constrained to the window viewport",
);
assert(
  app.includes("overflow-x-hidden"),
  "standalone shell should prevent horizontal window overflow",
);
assert(
  app.includes("overflow-y-auto"),
  "standalone shell should provide its own vertical scroll container",
);

if (!process.exitCode) {
  console.log("Onboarding surface verification passed");
}
