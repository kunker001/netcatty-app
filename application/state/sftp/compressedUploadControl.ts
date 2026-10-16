export type CompressedUploadResumeOutcome =
  | { kind: "resumed" }
  | { kind: "restart"; reason?: string }
  | { kind: "failed"; reason: string };

export async function resumeCompressedUploadSafely(params: {
  transferId: string;
  reconnectRequired: boolean;
  resume?: (transferId: string) => Promise<{ success: boolean; reason?: string }>;
}): Promise<CompressedUploadResumeOutcome> {
  const result = await (params.resume?.(params.transferId)
    ?? { success: false, reason: "Resume unavailable" });
  if (result.success) return { kind: "resumed" };
  if (params.reconnectRequired) return { kind: "restart", reason: result.reason };
  return { kind: "failed", reason: result.reason ?? "Could not resume the compressed upload." };
}
