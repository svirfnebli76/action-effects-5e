const NUMERIC_FIELDS = new Set(["schema", "level", "order", "cost"]);
const BOOLEAN_FIELDS = new Set(["consume", "configure"]);

function diagnostic(code, message, extra = {}) {
  return Object.freeze({ severity: "error", code, message, ...extra });
}

function normalizeScalar(key, value) {
  if (NUMERIC_FIELDS.has(key)) {
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return value;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }

  if (BOOLEAN_FIELDS.has(key)) {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return value;
}

function unescape(value) {
  let result = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else {
      result += char;
    }
  }
  if (escaped) result += "\\";
  return result;
}

function stripOuterQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  return value;
}

function splitTopLevel(input, delimiter, { firstOnly = false } = {}) {
  const parts = [];
  let buffer = "";
  let quote = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      buffer += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      buffer += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return { ok: false, reason: "unbalanced-parentheses" };
      buffer += char;
      continue;
    }
    if (char === delimiter && depth === 0) {
      parts.push(buffer);
      buffer = "";
      if (firstOnly) {
        parts.push(input.slice(index + 1));
        return { ok: true, parts };
      }
      continue;
    }
    buffer += char;
  }

  if (escaped) buffer += "\\";
  if (quote) return { ok: false, reason: "unbalanced-quote" };
  if (depth !== 0) return { ok: false, reason: "unbalanced-parentheses" };
  parts.push(buffer);
  return { ok: true, parts };
}

/**
 * Parser for the compact single-key Sneak Attack declaration grammar.
 * It performs structural parsing only; it never evaluates declaration values.
 */
export class SneakAttackDeclarationParser {
  parse(value) {
    const source = String(value ?? "").trim();
    if (!source) {
      return {
        ok: false,
        source,
        declaration: null,
        diagnostics: [diagnostic("empty-declaration", "Sneak Attack declaration Value is empty.")]
      };
    }

    const segments = splitTopLevel(source, ";");
    if (!segments.ok) {
      return {
        ok: false,
        source,
        declaration: null,
        diagnostics: [diagnostic(segments.reason, `Sneak Attack declaration has ${segments.reason.replaceAll("-", " ")}.`)]
      };
    }

    const declaration = {};
    const diagnostics = [];
    for (const rawSegment of segments.parts) {
      const segment = rawSegment.trim();
      if (!segment) continue;

      const pair = splitTopLevel(segment, "=", { firstOnly: true });
      if (!pair.ok) {
        diagnostics.push(diagnostic(pair.reason, `Malformed declaration segment '${segment}'.`, { segment }));
        continue;
      }

      if (pair.parts.length === 1) {
        const key = unescape(pair.parts[0].trim());
        if (!key) {
          diagnostics.push(diagnostic("empty-key", "Declaration contains an empty bare toggle.", { segment }));
          continue;
        }
        if (Object.hasOwn(declaration, key)) {
          diagnostics.push(diagnostic("duplicate-field", `Declaration field '${key}' is repeated.`, { field: key }));
          continue;
        }
        declaration[key] = true;
        continue;
      }

      const key = unescape(pair.parts[0].trim());
      const rawValue = pair.parts[1].trim();
      if (!key) {
        diagnostics.push(diagnostic("empty-key", `Declaration segment '${segment}' has no key.`, { segment }));
        continue;
      }
      if (!rawValue) {
        diagnostics.push(diagnostic("empty-value", `Declaration field '${key}' has no value.`, { field: key }));
        continue;
      }
      if (Object.hasOwn(declaration, key)) {
        diagnostics.push(diagnostic("duplicate-field", `Declaration field '${key}' is repeated.`, { field: key }));
        continue;
      }

      const normalizedText = unescape(stripOuterQuotes(rawValue));
      declaration[key] = normalizeScalar(key, normalizedText);
    }

    return {
      ok: diagnostics.length === 0,
      source,
      declaration,
      diagnostics
    };
  }
}
