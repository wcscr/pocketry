/** Compare plain JSON data without materializing repeated strings. Keep object
 * key order and omitted optional fields consistent with our former JSON checks.
 * Inputs are JSON/schema data, not class instances or objects with toJSON hooks.
 */
export function sameJsonData(left: unknown, right: unknown): boolean {
  const compared = new WeakMap<object, WeakSet<object>>();
  function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === "number" && !Number.isFinite(a)) a = null;
    if (typeof b === "number" && !Number.isFinite(b)) b = null;
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (compared.get(a)?.has(b)) return true;
    let matches: boolean;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      matches = true;
      for (let index = 0; index < a.length; index++) {
        if (!equal(a[index] ?? null, b[index] ?? null)) { matches = false; break; }
      }
    } else {
      const plain = (value: object) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
      if (!plain(a) || !plain(b)) return false;
      const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
      const keys = Object.keys(first).filter(key => first[key] !== undefined);
      const otherKeys = Object.keys(second).filter(key => second[key] !== undefined);
      matches = keys.length === otherKeys.length && keys.every((key, index) => key === otherKeys[index] && equal(first[key], second[key]));
    }
    if (matches) {
      let peers = compared.get(a);
      if (!peers) { peers = new WeakSet(); compared.set(a, peers); }
      peers.add(b);
    }
    return matches;
  }
  return equal(left, right);
}
