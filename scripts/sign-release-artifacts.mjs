#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const productName = "ClipForge";
const requireSignatures = process.env.CLIPFORGE_RELEASE_REQUIRE_SIGNATURES === "1";
const privateKeyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || "";
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || "";
const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "";

function fail(message) {
  console.error(`[release-sign] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(releaseDir)) {
  if (requireSignatures) fail("release directory does not exist");
  console.log("[release-sign] release directory missing; skipping signing");
  process.exit(0);
}

const artifacts = fs
  .readdirSync(releaseDir)
  .filter((fileName) => fileName.startsWith(`${productName}_${version}_`) && /\.(dmg|zip|app\.tar\.gz)$/.test(fileName))
  .sort();

if (!artifacts.length) {
  if (requireSignatures) fail(`no ${productName} ${version} artifacts found`);
  console.log("[release-sign] no release artifacts found; skipping signing");
  process.exit(0);
}

if (!privateKeyPath && !privateKey) {
  if (requireSignatures) {
    fail("set TAURI_SIGNING_PRIVATE_KEY_PATH or TAURI_SIGNING_PRIVATE_KEY before publishing signed updater artifacts");
  }
  console.log("[release-sign] signing key not configured; unsigned local artifacts are allowed");
  process.exit(0);
}

for (const fileName of artifacts) {
  const artifactPath = path.join(releaseDir, fileName);
  const args = ["tauri", "signer", "sign"];
  if (privateKeyPath) args.push("--private-key-path", privateKeyPath);
  if (privateKey) args.push("--private-key", privateKey);
  args.push("--password", password, artifactPath);
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });

  const signaturePath = `${artifactPath}.sig`;
  if (!fs.existsSync(signaturePath) || !fs.readFileSync(signaturePath, "utf8").trim()) {
    fail(`signature was not generated for ${fileName}`);
  }
  console.log(`[release-sign] signed ${fileName}`);
}
