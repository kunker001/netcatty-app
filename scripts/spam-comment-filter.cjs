"use strict";

const TRUSTED_AUTHOR_ASSOCIATIONS = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

const DANGEROUS_FILE_EXTENSION =
  "(?:zip|7z|rar|tar\\.gz|tgz|exe|msi|dmg|pkg|deb|rpm|appimage|bat|cmd|ps1|scr|vbs)";

const dangerousFilePattern = new RegExp(
  `(?:^|[\\s([<"'=])([^\\s()[\\]<>\"']+\\.${DANGEROUS_FILE_EXTENSION})(?=$|[\\s)\\]>\"']|[.,!?;:](?:$|\\s))`,
  "gi"
);

const zipFilePattern = new RegExp(
  `(?:^|[\\s([<"'=])([^\\s()[\\]<>\"']+\\.zip)(?=$|[\\s)\\]>\"']|[.,!?;:](?:$|\\s))`,
  "gi"
);

const githubUserAttachmentPattern =
  /^https:\/\/github\.com\/user-attachments\/files\/\d+\//i;

function normalizeAssociation(authorAssociation) {
  return String(authorAssociation || "").trim().toUpperCase();
}

function isTrustedAuthor(authorAssociation) {
  return TRUSTED_AUTHOR_ASSOCIATIONS.has(normalizeAssociation(authorAssociation));
}

function extractMatches(body, pattern) {
  const files = [];
  for (const match of body.matchAll(pattern)) {
    files.push(match[1]);
  }
  return [...new Set(files)];
}

function extractDangerousFiles(body) {
  return extractMatches(body, dangerousFilePattern);
}

function extractZipFiles(body) {
  return extractMatches(body, zipFilePattern);
}

function isGitHubUserAttachment(file) {
  return githubUserAttachmentPattern.test(file);
}

function detectSpamComment({ body, authorAssociation, userType } = {}) {
  const normalizedBody = String(body || "").replace(/\s+/g, " ").trim();
  const dangerousFiles = extractDangerousFiles(normalizedBody);
  const zipFiles = extractZipFiles(normalizedBody);
  const trustedAuthor = isTrustedAuthor(authorAssociation);
  const botAuthor = String(userType || "").toLowerCase() === "bot";

  const reasons = [];
  let score = 0;

  if (zipFiles.length > 0) {
    score += 10;
    reasons.push(`zip attachment or link: ${zipFiles.join(", ")}`);
  } else if (dangerousFiles.length > 0) {
    score += 10;
    reasons.push(`dangerous downloadable file: ${dangerousFiles.join(", ")}`);
  }

  // Hard rule: any zip (or other dangerous downloadable) from an untrusted
  // human is deleted. Maintainers and bots are exempt.
  const spam =
    !trustedAuthor &&
    !botAuthor &&
    (zipFiles.length > 0 || dangerousFiles.length > 0);

  return {
    spam,
    score: spam ? score : 0,
    reasons: spam ? reasons : [],
    dangerousFiles: zipFiles.length > 0 ? zipFiles : dangerousFiles,
    trustedAuthor,
    botAuthor,
  };
}

module.exports = {
  detectSpamComment,
  extractDangerousFiles,
  extractZipFiles,
  isGitHubUserAttachment,
  isTrustedAuthor,
};
