/**
 * Persist plugin sync secrets then connect; roll back just-created secrets if
 * connect (or a later put) fails so bad passwords are not left in OS storage.
 * Overwritten keys are restored from the host-side overwrite stash so a
 * rejected reconnect does not leave a broken SecretRef / rejected credential.
 */

export type PluginSyncSecretRef = { kind: 'secret'; id: string; key: string };

export interface PluginSyncConnectSecretInput {
  secretKey: string;
  value: string;
}

export interface PluginSyncPutSecretResult extends PluginSyncSecretRef {
  /** False when the durable (plugin,key) row already existed and was overwritten. */
  created?: boolean;
}

export interface StorePluginSyncSecretsThenConnectParams {
  providerId: string;
  secrets: readonly PluginSyncConnectSecretInput[];
  /** Reused when `secrets` is empty (edit non-secret fields / reconnect). */
  existingCredential?: PluginSyncSecretRef;
  putSecret: (params: {
    providerId: string;
    key: string;
    value: string;
  }) => Promise<PluginSyncPutSecretResult>;
  deleteSecrets: (params: {
    providerId: string;
    keys: string[];
  }) => Promise<unknown>;
  /**
   * Restore host-stashed plaintext for overwritten keys (`discard: false`),
   * or drop the stash after a successful connect (`discard: true`).
   */
  restoreSecrets?: (params: {
    providerId: string;
    keys: string[];
    discard?: boolean;
  }) => Promise<unknown>;
  connect: (credential: PluginSyncSecretRef | undefined) => Promise<void>;
}

export async function storePluginSyncSecretsThenConnect(
  params: StorePluginSyncSecretsThenConnectParams,
): Promise<void> {
  const createdKeys: string[] = [];
  const overwrittenKeys: string[] = [];
  let credential: PluginSyncSecretRef | undefined = params.existingCredential;

  try {
    if (params.secrets.length > 0) {
      credential = undefined;
      for (const secret of params.secrets) {
        const ref = await params.putSecret({
          providerId: params.providerId,
          key: secret.secretKey,
          value: secret.value,
        });
        if (ref.created === false) {
          overwrittenKeys.push(secret.secretKey);
        } else {
          createdKeys.push(secret.secretKey);
        }
        // SyncConnectPayload.credential carries the primary (first) secret;
        // additional secrets remain addressable via secrets.get(key).
        if (!credential) credential = ref;
      }
    }
    await params.connect(credential);
    if (overwrittenKeys.length > 0 && params.restoreSecrets) {
      try {
        await params.restoreSecrets({
          providerId: params.providerId,
          keys: [...overwrittenKeys],
          discard: true,
        });
      } catch {
        /* best-effort stash cleanup */
      }
    }
  } catch (error) {
    if (createdKeys.length > 0) {
      try {
        await params.deleteSecrets({
          providerId: params.providerId,
          keys: [...createdKeys],
        });
      } catch {
        /* best-effort; surface the original connect/put error */
      }
    }
    if (overwrittenKeys.length > 0 && params.restoreSecrets) {
      try {
        await params.restoreSecrets({
          providerId: params.providerId,
          keys: [...overwrittenKeys],
        });
      } catch {
        /* best-effort; surface the original connect/put error */
      }
    }
    throw error;
  }
}
