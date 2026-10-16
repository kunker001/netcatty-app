import test from "node:test";
import assert from "node:assert/strict";

import type { SftpFileEntry } from "../types.ts";
import {
  getSftpListUploadFilesTargetPath,
  getSftpTreeUploadFilesTargetPath,
  getSftpUploadFilesLabelKey,
  getSftpUploadFolderLabelKey,
  shouldShowSftpUploadFolderMenu,
  shouldShowSftpUploadFilesMenu,
} from "./sftp/sftpUploadMenu.ts";

const baseEntry: SftpFileEntry = {
  name: "notes.txt",
  type: "file",
  size: 1,
  sizeFormatted: "1 B",
  lastModified: 1,
  lastModifiedFormatted: "now",
};

test("upload file menu is shown only for remote panes with a picker upload handler", () => {
  assert.equal(shouldShowSftpUploadFilesMenu({ isLocal: false, hasFileListUpload: true }), true);
  assert.equal(shouldShowSftpUploadFilesMenu({ isLocal: true, hasFileListUpload: true }), false);
  assert.equal(shouldShowSftpUploadFilesMenu({ isLocal: false, hasFileListUpload: false }), false);
});

test("upload folder menu is shown only for remote panes with a folder upload handler", () => {
  assert.equal(shouldShowSftpUploadFolderMenu({ isLocal: false, hasFolderUpload: true }), true);
  assert.equal(shouldShowSftpUploadFolderMenu({ isLocal: true, hasFolderUpload: true }), false);
  assert.equal(shouldShowSftpUploadFolderMenu({ isLocal: false, hasFolderUpload: false }), false);
});

test("directory row upload targets that directory without using its name in the label", () => {
  const directoryEntry: SftpFileEntry = {
    ...baseEntry,
    name: "a-very-long-folder-name-that-should-not-expand-the-context-menu",
    type: "directory",
  };

  assert.equal(
    getSftpListUploadFilesTargetPath(directoryEntry, "/home/app"),
    "/home/app/a-very-long-folder-name-that-should-not-expand-the-context-menu",
  );
  assert.equal(getSftpUploadFilesLabelKey(directoryEntry), "sftp.context.uploadFilesHere");
  assert.equal(getSftpUploadFolderLabelKey(directoryEntry), "sftp.context.uploadFolderHere");
});

test("file row upload targets the current directory", () => {
  assert.equal(getSftpListUploadFilesTargetPath(baseEntry, "/home/app"), undefined);
  assert.equal(getSftpUploadFilesLabelKey(baseEntry), "sftp.context.uploadFiles");
  assert.equal(getSftpUploadFolderLabelKey(baseEntry), "sftp.context.uploadFolder");
});

test("tree directory row upload targets that directory", () => {
  const directoryEntry: SftpFileEntry = {
    ...baseEntry,
    name: "logs",
    type: "directory",
  };

  assert.equal(getSftpTreeUploadFilesTargetPath(directoryEntry, "/var/logs"), "/var/logs");
  assert.equal(getSftpUploadFilesLabelKey(directoryEntry), "sftp.context.uploadFilesHere");
  assert.equal(getSftpUploadFolderLabelKey(directoryEntry), "sftp.context.uploadFolderHere");
});

test("tree file row upload targets the file parent directory", () => {
  assert.equal(getSftpTreeUploadFilesTargetPath(baseEntry, "/var/logs/app.log"), "/var/logs");
  assert.equal(getSftpUploadFilesLabelKey(baseEntry), "sftp.context.uploadFiles");
  assert.equal(getSftpUploadFolderLabelKey(baseEntry), "sftp.context.uploadFolder");
});
