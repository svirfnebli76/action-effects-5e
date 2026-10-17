export const isObject = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const getPath = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
export const validId = value => typeof value === "string" && /^[a-z][a-zA-Z0-9_-]{0,79}$/.test(value);

export function jsonIssues(value, seen = new Set(), path = "record") {
  if (value === null || ["string", "boolean"].includes(typeof value)) return [];
  if (typeof value === "number" && Number.isFinite(value)) return [];
  if (typeof value !== "object") return [`${path} must contain JSON values.`];
  if (seen.has(value)) return [`${path} contains a circular reference.`];
  if (!Array.isArray(value) && !isObject(value)) return [`${path} must contain plain JSON objects.`];
  seen.add(value);
  const issues = [];
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) issues.push(`${path}.${key} is not an allowed key.`);
    issues.push(...jsonIssues(child, seen, `${path}.${key}`));
  }
  seen.delete(value);
  return issues;
}

/** JSON.parse accepts duplicate keys. Authoring must reject them before data is lost. */
export function parseDeclarationJson(text) {
  try {
    const data = JSON.parse(text);
    const tokens = String(text).match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
    let index = 0;
    const issues = [];
    const walk = () => {
      const token = tokens[index++];
      if (token === "{") {
        const keys = new Set();
        while (tokens[index] !== "}") {
          const key = JSON.parse(tokens[index++]);
          if (keys.has(key)) issues.push(`Duplicate JSON key '${key}'.`);
          keys.add(key);
          index++; // colon
          walk();
          if (tokens[index] !== ",") break;
          index++;
        }
        index++;
      } else if (token === "[") {
        while (tokens[index] !== "]") {
          walk();
          if (tokens[index] !== ",") break;
          index++;
        }
        index++;
      }
    };
    walk();
    issues.push(...jsonIssues(data));
    return { valid: !issues.length, data, issues };
  } catch (error) {
    return { valid: false, data: null, issues: [`Invalid JSON: ${error.message}`] };
  }
}
