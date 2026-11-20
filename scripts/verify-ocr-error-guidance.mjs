#!/usr/bin/env node
/**
 * OCR 错误提示脱敏静态门禁（clipboard-interaction-repair 第 3 项 + 第 9 项 / 提案 §14、§27）。
 *
 * 验证目标：
 *  1. 前端错误码白名单与 Rust `src-tauri/src/ocr/*.rs` 源码冻结的 `OCR_*` 前缀一致；
 *  2. 原始 detail 中的 URL / 内网地址 / 端口 / 绝对路径 / 凭据 / 邮箱绝不进入展示与复制文本；
 *  3. 未知码 / 非 OCR 码 / 无前缀 / null 一律收敛为 UNKNOWN，不回传 detail；
 *  4. 所有 `main.error.ocr.*` 文案 key 在 zh-CN / en-US 都存在且中英对齐；
 *  5. 调用点 `use-ocr-extract.ts` 已移除 `truncateText(String(error))` 泄露写法并接线脱敏编排。
 *
 * 纯静态断言，不需要 GUI / 解锁 / 网络 / 外部模型，也不替代沙箱实机走查。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), "clipforge-ocr-guidance-"));

try {
  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "--lib", "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--rootDir", "src",
      "--outDir", outDir,
      "src/clipboard/ocr-error-guidance.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(join(outDir, "clipboard/ocr-error-guidance.js")).href);

  // ---------- 1. 错误码白名单与 Rust 源码一致性 ----------
  const rustDir = join(root, "src-tauri/src/ocr");
  const rustSources = readFileSync(join(rustDir, "extract.rs"), "utf8")
    + readFileSync(join(rustDir, "cache.rs"), "utf8")
    + readFileSync(join(rustDir, "endpoint.rs"), "utf8")
    + readFileSync(join(rustDir, "builtin.rs"), "utf8")
    + readFileSync(join(rustDir, "builtin/macos.rs"), "utf8");
  const rustCodes = new Set(
    [...rustSources.matchAll(/["'](OCR_[A-Z0-9_]+):/g)].map((m) => m[1]),
  );
  assert.equal(rustCodes.size, 14, "Rust 侧引号内 OCR_* 错误码应为 14 个，新增码需同步前端");
  for (const code of rustCodes) {
    assert.ok(mod.OCR_ERROR_CODES.includes(code), `前端白名单缺少 Rust 错误码 ${code}`);
  }
  for (const code of mod.OCR_ERROR_CODES) {
    assert.ok(rustCodes.has(code), `前端白名单含 Rust 不存在的错误码 ${code}`);
    assert.ok(mod.OCR_GUIDANCE_KEYS[code], `${code} 缺少 reasonKey/fixKey 映射`);
  }

  // ---------- 2. 解析：只取码，绝不回传 detail ----------
  assert.equal(mod.parseOcrErrorCode("OCR_ENDPOINT_UNAVAILABLE: http://10.1.7.28:8491/v1: refused"), "OCR_ENDPOINT_UNAVAILABLE");
  assert.equal(mod.parseOcrErrorCode(new Error("OCR_TIMEOUT: exceeded 60s")), "OCR_TIMEOUT");
  assert.equal(mod.parseOcrErrorCode("OCR_FUTURE_CODE: secret"), "UNKNOWN", "未来新增码未登记时必须收敛");
  assert.equal(mod.parseOcrErrorCode("CLIP_NOT_FOUND: /Users/meng/x.png"), "UNKNOWN", "非 OCR 码收敛");
  assert.equal(mod.parseOcrErrorCode("connection refused"), "UNKNOWN");
  assert.equal(mod.parseOcrErrorCode(null), "UNKNOWN");
  assert.equal(mod.parseOcrErrorCode(undefined), "UNKNOWN");

  // ---------- 3. 敏感片段检出本身要可靠 ----------
  const leakProbe = "http://10.1.7.28:8491/v1/chat 127.0.0.1:8491 /Users/meng/Library/secret.png sk-abcdefgh1234 apiKey=xyz a@b.com";
  const probeHits = mod.findSensitiveFragments(leakProbe);
  for (const fragment of ["http://10.1.7.28:8491/v1/chat", "127.0.0.1:8491", "/Users/meng/Library/secret.png", "sk-abcdefgh1234", "apiKey=xyz", "a@b.com"]) {
    assert.ok(probeHits.includes(fragment), `检出器漏判敏感片段：${fragment}`);
  }

  // ---------- 4. i18n 字典：所有文案 key 存在、中英对齐、步骤非空 ----------
  const zh = JSON.parse(readFileSync(join(root, "src/i18n/locales/zh-CN.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en-US.json"), "utf8"));
  const allKeys = [
    ...Object.values(mod.OCR_GUIDANCE_KEYS).flatMap(({ reasonKey, fixKey }) => [reasonKey, fixKey]),
    mod.OCR_UNKNOWN_KEYS.reasonKey,
    mod.OCR_UNKNOWN_KEYS.fixKey,
    ...Object.values(mod.OCR_COPY_KEYS),
  ];
  for (const key of allKeys) {
    assert.ok(typeof zh[key] === "string" && zh[key].length > 0, `zh-CN 缺文案 key：${key}`);
    assert.ok(typeof en[key] === "string" && en[key].length > 0, `en-US 缺文案 key：${key}`);
  }
  // 字典整体 key 对齐（与 verify-i18n-runtime 同一契约）。
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh-CN 与 en-US 字典 key 未对齐");

  const translate = (key) => zh[key];
  const trEn = (key) => en[key];

  // ---------- 5. 展示与复制文本零泄露（含恶意 detail 注入） ----------
  const maliciousDetails = [
    "OCR_ENDPOINT_UNAVAILABLE: http://10.1.7.28:8491/v1/chat/completions: connection refused",
    "OCR_ENDPOINT_NOT_LOCAL: http://192.168.1.50:11434/api/generate: not loopback",
    "OCR_IMAGE_READ_FAILED: /Users/meng/Library/Application Support/ClipForge/images/a.png: no such file",
    "OCR_ENDPOINT_ERROR: HTTP 401: apiKey=sk-live-abcdefgh1234 Bearer sk-abcdefgh1234",
    "OCR_BAD_RESPONSE: admin@corp.example.com parse error",
  ];
  for (const detail of maliciousDetails) {
    for (const tr of [translate, trEn]) {
      const guidance = mod.buildOcrErrorGuidance(detail, tr);
      assert.equal(mod.findOcrGuidanceLeaks(guidance).length, 0, `脱敏失败：${detail}`);
      assert.ok(!guidance.description.includes(detail), "原始异常串不得整体进入展示文本");
      assert.ok(!guidance.copyText.includes(detail), "原始异常串不得整体进入复制文本");
      const codeTokens = guidance.copyText.match(/OCR_[A-Z0-9_]+/g) ?? [];
      assert.ok(codeTokens.every((token) => token === guidance.code), "复制文本只允许出现当前脱敏错误码");
      assert.ok(guidance.fixSteps.length >= 2, "修复方案至少两步");
      assert.ok(guidance.reason.length > 0, "原因文案不得为空");
      assert.ok(guidance.copyText.includes(guidance.code), "复制文本需带脱敏错误码");
      assert.ok(guidance.copyText.includes("1. "), "复制文本需编号步骤");
    }
  }

  // ---------- 6. UNKNOWN 兜底也不泄露 ----------
  const unknown = mod.buildOcrErrorGuidance("CLIP_LOAD_FAILED: /Users/meng/db.sqlite: locked", translate);
  assert.equal(unknown.code, "UNKNOWN");
  assert.equal(mod.findOcrGuidanceLeaks(unknown).length, 0);
  assert.ok(unknown.copyText.includes("UNKNOWN"));

  // ---------- 7. 调用点源码接线（第 9 项回归静态断言） ----------
  const caller = readFileSync(join(root, "src/clipboard/use-ocr-extract.ts"), "utf8");
  assert.ok(!caller.includes("truncateText(String(error)"), "OCR 失败提示不得再把原始错误截断后直接展示");
  assert.ok(caller.includes("buildOcrErrorGuidance"), "调用点需接线脱敏编排");
  assert.ok(caller.includes("closeButton: true"), "错误提示需可关闭");
  assert.ok(caller.includes("action:"), "错误提示需提供可复制修复方案的入口");
  assert.ok(caller.includes("findOcrGuidanceLeaks"), "调用点需做展示前脱敏兜底");

  console.log("[unit] ocr-error-guidance checks passed (code parity, redaction, i18n parity, caller wiring)");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
