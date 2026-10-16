import { compressedUploadRequiresDedicatedSession } from "../../../domain/sftpDedicatedStreamPolicy";

export interface CompressedUploadSessionLease {
  sftpId: string;
  release: () => void;
  discard: () => void;
}

export async function runWithCompressedUploadSession<T>(params: {
  enabled: boolean;
  hasDirectory: boolean;
  isLocal: boolean;
  hostId?: string;
  jobId: string;
  prepSftpId: string | null;
  acquire?: (hostId: string, jobId: string) => Promise<CompressedUploadSessionLease>;
  shouldDiscard: (error: unknown) => boolean;
  run: (sftpId: string | null) => Promise<T>;
}): Promise<T> {
  const required = compressedUploadRequiresDedicatedSession(params);
  if (required && (!params.acquire || !params.hostId)) {
    throw new Error("Dedicated transfer session unavailable");
  }

  let lease: CompressedUploadSessionLease | null = null;
  try {
    if (required && params.acquire && params.hostId) {
      lease = await params.acquire(params.hostId, params.jobId);
    }
    return await params.run(lease?.sftpId ?? params.prepSftpId);
  } catch (error) {
    if (lease && params.shouldDiscard(error)) {
      lease.discard();
      lease = null;
    }
    throw error;
  } finally {
    lease?.release();
  }
}
