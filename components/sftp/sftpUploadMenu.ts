import type { SftpFileEntry } from "../../types";
import { getParentPath, joinPath } from "../../application/state/sftp/utils";
import { isNavigableDirectory } from "./utils";

export const shouldShowSftpUploadFilesMenu = ({
  isLocal,
  hasFileListUpload,
}: {
  isLocal: boolean;
  hasFileListUpload: boolean;
}) => !isLocal && hasFileListUpload;

export const shouldShowSftpUploadFolderMenu = ({
  isLocal,
  hasFolderUpload,
}: {
  isLocal: boolean;
  hasFolderUpload: boolean;
}) => !isLocal && hasFolderUpload;

export const getSftpListUploadFilesTargetPath = (
  entry: SftpFileEntry,
  currentPath: string,
): string | undefined => {
  if (!isNavigableDirectory(entry) || entry.name === "..") {
    return undefined;
  }
  return joinPath(currentPath, entry.name);
};

export const getSftpTreeUploadFilesTargetPath = (
  entry: SftpFileEntry,
  entryPath: string,
): string | undefined => {
  if (entry.name === "..") {
    return undefined;
  }
  return isNavigableDirectory(entry) ? entryPath : getParentPath(entryPath);
};

export const getSftpUploadFilesLabelKey = (entry: SftpFileEntry): string =>
  isNavigableDirectory(entry) && entry.name !== ".."
    ? "sftp.context.uploadFilesHere"
    : "sftp.context.uploadFiles";

export const getSftpUploadFolderLabelKey = (entry: SftpFileEntry): string =>
  isNavigableDirectory(entry) && entry.name !== ".."
    ? "sftp.context.uploadFolderHere"
    : "sftp.context.uploadFolder";
