import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const productName = "ClipForge";
const channel = process.env.CLIPFORGE_RELEASE_CHANNEL === "prerelease" ? "prerelease" : "stable";
const repo = process.env.GITHUB_REPOSITORY || "embaobao/clipforge";
const tag = process.env.CLIPFORGE_RELEASE_TAG || `v${version}`;
const baseUrl =
  process.env.CLIPFORGE_RELEASE_BASE_URL ||
  `https://github.com/${repo}/releases/download/${tag}`;
const notesPath = process.env.CLIPFORGE_RELEASE_NOTES || "RELEASE_NOTES.md";
const pubDate = new Date().toISOString();
const requireSignatures = process.env.CLIPFORGE_RELEASE_REQUIRE_SIGNATURES === "1";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function platformFromArtifact(fileName) {
  if (!fileName.endsWith(".dmg")) return null;
  if (fileName.includes("_aarch64")) return "darwin-aarch64";
  if (fileName.includes("_x64") || fileName.includes("_x86_64")) return "darwin-x86_64";
  if (fileName.includes("_universal")) return "darwin-universal";
  return "darwin-aarch64";
}

fs.mkdirSync(releaseDir, { recursive: true });
const artifacts = fs
  .readdirSync(releaseDir)
  .filter((fileName) => fileName.startsWith(`${productName}_${version}_`) && /\.(dmg|zip|app\.tar\.gz)$/.test(fileName))
  .sort();

const checksumLines = artifacts.map((fileName) => `${sha256(path.join(releaseDir, fileName))}  ${fileName}`);
fs.writeFileSync(path.join(releaseDir, "checksums.txt"), `${checksumLines.join("\n")}\n`);

const platforms = {};
const missingSignatures = [];
for (const fileName of artifacts) {
  const platform = platformFromArtifact(fileName);
  if (!platform) continue;
  const signaturePath = path.join(releaseDir, `${fileName}.sig`);
  const signature = fs.existsSync(signaturePath) ? fs.readFileSync(signaturePath, "utf8").trim() : "";
  if (!signature) missingSignatures.push(fileName);
  platforms[platform] = {
    signature,
    url: `${baseUrl}/${encodeURIComponent(fileName)}`,
  };
}

if (requireSignatures) {
  if (!process.env.CLIPFORGE_UPDATER_PUBLIC_KEY) {
    console.error("CLIPFORGE_UPDATER_PUBLIC_KEY is required when CLIPFORGE_RELEASE_REQUIRE_SIGNATURES=1");
    process.exit(1);
  }
  if (missingSignatures.length) {
    console.error(`Missing updater signatures: ${missingSignatures.join(", ")}`);
    process.exit(1);
  }
}

const latest = {
  version,
  notes: fs.existsSync(path.join(root, notesPath))
    ? fs.readFileSync(path.join(root, notesPath), "utf8").trim()
    : `ClipForge ${version}`,
  pub_date: pubDate,
  platforms,
  clipforge: {
    channel,
    minAppVersion: version,
    critical: false,
    permissionsChanged: false,
    releaseNotesPath: notesPath,
  },
};

fs.writeFileSync(path.join(releaseDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);

console.log(`Generated release metadata:`);
console.log(`- release/latest.json`);
console.log(`- release/checksums.txt`);
console.log(`Release notes source: ${notesPath}`);
if (missingSignatures.length) {
  console.log(`Signing: unsigned local artifact(s): ${missingSignatures.join(", ")}`);
} else {
  console.log(`Signing: all platform artifacts include updater signatures.`);
}
