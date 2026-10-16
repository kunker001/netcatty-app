export const DIRECTORY_REPLACE_BACKUP_DELETE_ATTEMPTS = 3;

export function isMissingDirectoryReplacePathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|no such file|not found|does not exist/i.test(message);
}

export async function deleteDirectoryReplaceBackup(
  deleteBackup: () => Promise<unknown>,
  options: {
    attempts?: number;
    delay?: (attempt: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DIRECTORY_REPLACE_BACKUP_DELETE_ATTEMPTS);
  const delay = options.delay ?? ((attempt: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, attempt * 25);
  }));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await deleteBackup();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(attempt);
    }
  }
  throw lastError;
}

export interface DirectoryReplacePromotionOptions {
  targetPath: string;
  stagedPath: string;
  backupPath: string;
  statPath: (path: string) => Promise<unknown>;
  renamePath: (source: string, target: string) => Promise<unknown>;
  deletePath: (path: string) => Promise<unknown>;
}

async function pathExists(
  statPath: DirectoryReplacePromotionOptions["statPath"],
  candidate: string,
): Promise<boolean> {
  try {
    return Boolean(await statPath(candidate));
  } catch (error) {
    if (isMissingDirectoryReplacePathError(error)) return false;
    throw error;
  }
}

function createDirectoryReplaceRecoveryError(
  promotionError: unknown,
  restoreError: unknown,
  options: Pick<DirectoryReplacePromotionOptions, "targetPath" | "stagedPath" | "backupPath">,
): Error {
  const error = new Error(
    `Directory replacement failed and the original could not be restored. `
      + `Target: ${options.targetPath}; backup: ${options.backupPath}; stage: ${options.stagedPath}. `
      + `Promotion error: ${promotionError instanceof Error ? promotionError.message : String(promotionError)}. `
      + `Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
  );
  (error as Error & { cause?: unknown }).cause = promotionError;
  return error;
}

/**
 * Publish a fully-written replacement directory with one shared recovery rule.
 *
 * Both live transfers and restart resume use this transaction:
 * - restore the only known-good backup before touching anything else;
 * - remove only a stale backup that accompanies a live final target;
 * - ignore only a genuinely missing final target;
 * - restore the original if stage promotion fails;
 * - keep a committed target and its backup recoverable if cleanup keeps failing.
 */
export async function promoteDirectoryReplaceStage(
  options: DirectoryReplacePromotionOptions,
): Promise<void> {
  const {
    targetPath,
    stagedPath,
    backupPath,
    statPath,
    renamePath,
    deletePath,
  } = options;
  if (!targetPath || !stagedPath || !backupPath || stagedPath === targetPath) {
    throw new Error("Invalid directory replacement paths");
  }

  const backupExists = await pathExists(statPath, backupPath);
  if (backupExists) {
    if (await pathExists(statPath, targetPath)) {
      await deleteDirectoryReplaceBackup(() => deletePath(backupPath));
    } else {
      // An interrupted prior commit left the backup as the only known-good tree.
      // Restore it before creating a new backup or publishing a rebuilt stage.
      await renamePath(backupPath, targetPath);
    }
  }

  let backedUp = false;
  try {
    await renamePath(targetPath, backupPath);
    backedUp = true;
  } catch (error) {
    // Permission, conflict, and transport failures must stop publication. Only
    // a missing target is safe to treat as a new-directory replacement.
    if (!isMissingDirectoryReplacePathError(error)) throw error;
  }

  try {
    await renamePath(stagedPath, targetPath);
  } catch (promotionError) {
    if (backedUp) {
      try {
        await renamePath(backupPath, targetPath);
      } catch (restoreError) {
        throw createDirectoryReplaceRecoveryError(promotionError, restoreError, options);
      }
    }
    throw promotionError;
  }

  if (backedUp) {
    // Publication is already committed. Persistent cleanup failure deliberately
    // leaves both final and backup present and reports a retryable failure.
    await deleteDirectoryReplaceBackup(() => deletePath(backupPath));
  }
}
