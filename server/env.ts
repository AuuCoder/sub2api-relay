import fs from "node:fs";
import path from "node:path";

const globalFlag = "__ASXS_RELAY_ENV_LOADED__";

function decodeQuotedValue(value: string) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== `"` && quote !== `'`) || value[value.length - 1] !== quote) {
    return value;
  }

  const inner = value.slice(1, -1);
  if (quote === `'`) return inner;

  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, `"`)
    .replace(/\\\\/g, "\\");
}

function parseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = normalized.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let rawValue = normalized.slice(separatorIndex + 1).trim();
  if (!rawValue) {
    return { key, value: "" };
  }

  if (rawValue.startsWith(`"`) || rawValue.startsWith(`'`)) {
    return { key, value: decodeQuotedValue(rawValue) };
  }

  const commentIndex = rawValue.search(/\s+#/);
  if (commentIndex >= 0) {
    rawValue = rawValue.slice(0, commentIndex).trim();
  }

  return { key, value: rawValue };
}

function loadEnvFile(filePath: string, lockedKeys: Set<string>) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (lockedKeys.has(parsed.key)) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function ensureEnvLoaded() {
  if ((globalThis as Record<string, unknown>)[globalFlag]) return;
  (globalThis as Record<string, unknown>)[globalFlag] = true;

  const cwd = process.cwd();
  const protectedKeys = new Set(Object.keys(process.env));

  loadEnvFile(path.join(cwd, ".env.example"), protectedKeys);
  loadEnvFile(path.join(cwd, ".env"), protectedKeys);
}

ensureEnvLoaded();
