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

function extractRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert(Boolean(match), `${selector} rule is missing`);
  return match?.[1] ?? "";
}

function hasDeclaration(rule, property, value) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*${escapedValue}\\s*(?:;|$)`).test(rule);
}

const app = read("src/onboarding/OnboardingApp.tsx");
const onboardingCss = read("src/onboarding/onboarding.css");
const shellRule = extractRule(onboardingCss, ".onboarding-standalone-shell");

assert(
  app.includes('className="onboarding-standalone-shell" data-surface="onboarding"'),
  "standalone onboarding root should keep a stable surface marker",
);
assert(
  hasDeclaration(shellRule, "height", "100dvh"),
  "standalone shell should be constrained to the fixed window viewport",
);
assert(
  hasDeclaration(shellRule, "min-height", "0"),
  "standalone shell should be allowed to shrink inside the viewport",
);
assert(
  hasDeclaration(shellRule, "overflow-x", "hidden"),
  "standalone shell should prevent horizontal window overflow",
);
assert(
  hasDeclaration(shellRule, "overflow-y", "auto"),
  "standalone shell should provide its own vertical scroll container",
);
assert(
  hasDeclaration(shellRule, "justify-content", "flex-start"),
  "overflowing onboarding content should start at the top of the viewport",
);

if (!process.exitCode) {
  console.log("Onboarding surface verification passed");
}
