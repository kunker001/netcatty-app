import type { DropEntry } from "./sftpFileUtils";
import { getDropEntryLocalPath } from "./sftpFileUtils";
import type { Host } from "../types";

const ZMODEM_RZ_MISSING_MARKER_PREFIX = "\x1b]1337;NetcattyRzMissing=";
const ZMODEM_RZ_MISSING_MARKER_SUFFIX = "\x07";

/**
 * Default PTY command for drag-drop ZMODEM upload.
 * lrzsz `rz` defaults to protect mode and will not replace an existing
 * same-named file; `-y` / `--overwrite` is required (issue #2863).
 */
export const ZMODEM_DEFAULT_RZ_UPLOAD_COMMAND = "rz -y\r";

export type ZmodemDragDropFile = {
  path?: string;
  name: string;
  remoteName: string;
  data?: ArrayBuffer;
};

export function supportsZmodemTerminalDragDrop(
  host: Host,
  isNetworkDevice = false,
): boolean {
  if (host.protocol === "local" || isNetworkDevice) return false;
  if (host.moshEnabled || host.etEnabled) return true;
  return (
    host.protocol === "ssh" ||
    host.protocol === "telnet" ||
    host.protocol === "serial"
  );
}

export function supportsZmodemDragDropSftpFallback(host: Host): boolean {
  return host.protocol === "ssh" || Boolean(host.moshEnabled || host.etEnabled);
}

export function getZmodemRemoteName(relativePath: string, fallbackName: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return fallbackName;
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || fallbackName;
}

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function createZmodemRzMissingToken(): string {
  return `rz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildZmodemDragDropUploadCommand(rzMissingToken: string): string {
  const markerFormat = `\\033]1337;NetcattyRzMissing=${rzMissingToken}\\007`;
  const script = `if command -v rz >/dev/null 2>&1; then exec rz -y; else printf ${quotePosixShellArg(markerFormat)}; fi`;
  return `sh -lc ${quotePosixShellArg(script)}\r`;
}

export function containsZmodemRzMissingMarker(chunk: string, rzMissingToken: string): boolean {
  return chunk.includes(`${ZMODEM_RZ_MISSING_MARKER_PREFIX}${rzMissingToken}${ZMODEM_RZ_MISSING_MARKER_SUFFIX}`);
}

export async function buildZmodemDragDropFiles(
  dropEntries: DropEntry[],
): Promise<ZmodemDragDropFile[]> {
  const files: ZmodemDragDropFile[] = [];

  for (const entry of dropEntries) {
    if (entry.isDirectory) continue;

    const fileName = entry.file?.name
      || entry.relativePath.replace(/\\/g, "/").split("/").pop()
      || entry.relativePath;
    const remoteName = getZmodemRemoteName(entry.relativePath, fileName);
    const localPath = getDropEntryLocalPath(entry);

    if (localPath) {
      files.push({
        path: localPath,
        name: fileName,
        remoteName,
      });
      continue;
    }

    if (!entry.file) continue;
    const data = await entry.file.arrayBuffer();
    files.push({
      name: fileName,
      remoteName,
      data,
    });
  }

  return files;
}
