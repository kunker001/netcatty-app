export const MAX_BUILTIN_SFTP_EDITOR_BYTES = 10 * 1024 * 1024;

export function assertSftpFileFitsBuiltinEditor(size: number | undefined): void {
  if (!Number.isFinite(size) || (size ?? 0) <= MAX_BUILTIN_SFTP_EDITOR_BYTES) return;
  throw new Error("This file is too large for the built-in editor (maximum 10 MB). Download it or open it with another app.");
}
