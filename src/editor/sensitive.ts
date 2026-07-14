export type SensitiveEditorFinding = {
  field: "content";
  kind: "api-key" | "bearer-token" | "private-key" | "password-assignment";
  label: string;
};

export function detectSensitiveEditorFields(content: string): SensitiveEditorFinding[] {
  const findings: SensitiveEditorFinding[] = [];
  const add = (kind: SensitiveEditorFinding["kind"], label: string) => {
    if (!findings.some((finding) => finding.kind === kind)) findings.push({ field: "content", kind, label });
  };
  if (/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b/.test(content)) {
    add("api-key", "疑似 API Key");
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i.test(content)) {
    add("bearer-token", "疑似 Bearer Token");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
    add("private-key", "疑似私钥");
  }
  if (/\b(?:password|passwd|pwd|secret)\s*[:=]\s*\S{6,}/i.test(content)) {
    add("password-assignment", "疑似密码或密钥赋值");
  }
  return findings;
}
