/**
 * Define an own enumerable/writable `__proto__` key, as JSON.parse can produce for
 * real user data. Tests for untrusted persisted input share this one definition.
 */
export function withProtoKey<T extends object>(target: T, value: unknown): T {
  Object.defineProperty(target, "__proto__", {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return target;
}
