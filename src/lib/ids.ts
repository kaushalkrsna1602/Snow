export function createId(prefix: string) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random, (part) => part.toString(36)).join("")}`;
}
