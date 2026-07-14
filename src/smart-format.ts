export type SmartFormatAnalysis = {
  kind: "json_minify" | "json_repair" | "json_unescape" | "url" | "base64" | "base64url" | "jwt" | "unicode" | "html_entity";
  label: string;
  output: string;
  error: string;
};

function decodeBase64(value: string) {
  if (typeof atob === "function") return atob(value);
  const buffer = (globalThis as unknown as { Buffer?: { from: (input: string, encoding: "base64") => { toString: (encoding: "utf8") => string } } }).Buffer;
  if (buffer) return buffer.from(value, "base64").toString("utf8");
  throw new Error("Base64 decoder is unavailable");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return decodeBase64(padded);
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(?:([a-z]+)|#([0-9]+)|#x([0-9a-f]+));/gi, (match, name: string, decimal: string, hex: string) => {
    if (name) return named[name.toLowerCase()] ?? match;
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function tryParseJson(value: string) {
  try {
    return { value: JSON.parse(value) as unknown, error: "" };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function repairJsonCandidate(value: string) {
  return value
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner: string) => JSON.stringify(inner.replace(/\\'/g, "'")))
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, "$1\"$2\"$3");
}

export function analyzeSmartFormats(content: string): SmartFormatAnalysis[] {
  const input = content.trim();
  if (!input || input.length > 120_000) return [];
  const analyses: SmartFormatAnalysis[] = [];
  const add = (kind: SmartFormatAnalysis["kind"], label: string, decode: () => string) => {
    try {
      const output = decode();
      if (output && output !== input) analyses.push({ kind, label, output, error: "" });
    } catch (error) {
      analyses.push({ kind, label, output: "", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const jsonParse = /^[\[{]/.test(input) ? tryParseJson(input) : { value: null, error: "" };
  if (!jsonParse.error && jsonParse.value !== null) {
    add("json_minify", "JSON Minify", () => JSON.stringify(jsonParse.value));
  } else if (/^[\[{]/.test(input)) {
    add("json_repair", "JSON Repair Suggestion", () => {
      const repaired = repairJsonCandidate(input);
      const parsed = tryParseJson(repaired);
      if (parsed.error) throw new Error(parsed.error);
      return JSON.stringify(parsed.value, null, 2);
    });
  }
  if (/^"\s*(?:\\.|[^"\\])*\s*"$/.test(input)) {
    add("json_unescape", "Escaped JSON String", () => {
      const first = JSON.parse(input);
      if (typeof first !== "string") throw new Error("不是 JSON 字符串");
      const parsed = tryParseJson(first);
      if (parsed.error) throw new Error(parsed.error);
      return JSON.stringify(parsed.value, null, 2);
    });
  }
  if (/%[0-9a-f]{2}/i.test(input)) {
    add("url", "URL Decode", () => decodeURIComponent(input));
  }
  if (/\\u[0-9a-f]{4}/i.test(input)) {
    add("unicode", "Unicode Escape", () => input.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
  }
  if (/&(?:[a-z]+|#[0-9]+|#x[0-9a-f]+);/i.test(input)) {
    add("html_entity", "HTML Entity", () => decodeHtmlEntities(input));
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(input) && input.length >= 8 && input.length % 4 === 0) {
    add("base64", "Base64", () => decodeBase64(input));
  }
  if (/^[A-Za-z0-9_-]+$/.test(input) && input.length >= 8) {
    add("base64url", "Base64URL", () => decodeBase64Url(input));
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(input)) {
    add("jwt", "JWT Header / Payload", () => {
      const [header, payload] = input.split(".");
      return JSON.stringify(
        {
          header: JSON.parse(decodeBase64Url(header)),
          payload: JSON.parse(decodeBase64Url(payload)),
        },
        null,
        2,
      );
    });
  }
  return analyses.slice(0, 6);
}
