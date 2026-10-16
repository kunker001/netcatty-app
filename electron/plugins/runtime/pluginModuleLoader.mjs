let mappings = new Map();

export function initialize(data) {
  mappings = new Map(Object.entries(data?.mappings ?? {}));
}

export function resolve(specifier, context, nextResolve) {
  const mapped = mappings.get(specifier);
  if (mapped) return { url: mapped, shortCircuit: true };
  return nextResolve(specifier, context);
}
