export const PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 100 * 1024 * 1024,
  uncompressedBytes: 250 * 1024 * 1024,
  singleFileBytes: 50 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  fileCount: 5_000,
  pathCharacters: 128,
  pathBytes: 512,
});

export const IGNORED_ROOT_ENTRIES = new Set([
  ".DS_Store",
  ".git",
  "node_modules",
]);
