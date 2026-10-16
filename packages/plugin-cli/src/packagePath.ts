import { PACKAGE_LIMITS } from "./constants.js";

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_SPECIAL = /[<>:"|?*]/;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function portablePathKey(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .normalize("NFKC");
}

function assertPortablePathSyntax(value: string, originalInput: string): string[] {
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    throw new Error(`Package path must be relative POSIX syntax: ${originalInput}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Package path contains an unsafe segment: ${originalInput}`);
  }
  for (const segment of segments) {
    if (
      segment.endsWith(".")
      || segment.endsWith(" ")
      || WINDOWS_RESERVED_NAME.test(segment)
      || WINDOWS_SPECIAL.test(segment)
      || containsControlCharacter(segment)
    ) {
      throw new Error(`Package path is not portable across supported platforms: ${originalInput}`);
    }
  }
  return segments;
}

export function assertSafePackagePath(input: string): string {
  if (!input || input !== input.normalize("NFC")) {
    throw new Error(`Package path must be non-empty NFC text: ${JSON.stringify(input)}`);
  }
  if ([...input].length > PACKAGE_LIMITS.pathCharacters) {
    throw new Error(
      `Package path exceeds ${PACKAGE_LIMITS.pathCharacters} Unicode characters: ${input}`,
    );
  }
  if (Buffer.byteLength(input, "utf8") > PACKAGE_LIMITS.pathBytes) {
    throw new Error(`Package path exceeds ${PACKAGE_LIMITS.pathBytes} UTF-8 bytes: ${input}`);
  }
  const rawSegments = assertPortablePathSyntax(input, input);
  const compatibilitySegments = assertPortablePathSyntax(input.normalize("NFKC"), input);
  if (compatibilitySegments.length !== rawSegments.length) {
    throw new Error(
      `Package path changes directory structure after Unicode compatibility normalization: ${input}`,
    );
  }
  return input;
}

export class PackagePathRegistry {
  readonly #filesExact = new Set<string>();
  readonly #filesPortable = new Set<string>();
  readonly #directoriesExact = new Set<string>();
  readonly #directoriesPortable = new Set<string>();

  add(input: string): string {
    const safePath = assertSafePackagePath(input);
    const portableKey = portablePathKey(safePath);
    if (this.#filesExact.has(safePath) || this.#filesPortable.has(portableKey)) {
      throw new Error(`Duplicate or case-colliding package path: ${safePath}`);
    }
    if (
      this.#directoriesExact.has(safePath)
      || this.#directoriesPortable.has(portableKey)
    ) {
      throw new Error(`File/directory package path collision: ${safePath}`);
    }

    const segments = safePath.split("/");
    const ancestors: string[] = [];
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      if (
        this.#filesExact.has(ancestor)
        || this.#filesPortable.has(portablePathKey(ancestor))
      ) {
        throw new Error(`File/directory package path collision: ${safePath}`);
      }
      ancestors.push(ancestor);
    }

    this.#filesExact.add(safePath);
    this.#filesPortable.add(portableKey);
    for (const ancestor of ancestors) {
      this.#directoriesExact.add(ancestor);
      this.#directoriesPortable.add(portablePathKey(ancestor));
    }
    return safePath;
  }
}
