"use strict";

const { PluginRpcError, RPC_ERRORS } = require("./rpcRouter.cjs");
const { MAX_SECRET_BYTES, assertSecretRef } = require("./secretStore.cjs");

function assertCredentialRef(credential) {
  if (credential?.kind === "secret") {
    return { kind: "secret", ...assertSecretRef(credential) };
  }
  if (
    !credential
    || typeof credential !== "object"
    || Array.isArray(credential)
    || credential.kind !== "credential"
    || typeof credential.id !== "string"
    || credential.id.length < 16
    || credential.id.length > 256
  ) throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Credential reference is invalid");
  return { kind: "credential", id: credential.id };
}

function assertLeaseParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Credential lease parameters are invalid");
  }
  const credential = assertCredentialRef(params.secret);
  if (typeof params.operationId !== "string" || params.operationId.length < 1 || params.operationId.length > 128) {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Credential lease operation ID is invalid");
  }
  if (typeof params.purpose !== "string" || params.purpose.length < 1 || params.purpose.length > 256) {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Credential lease purpose is invalid");
  }
  if (
    params.ttlMs !== undefined
    && (!Number.isSafeInteger(params.ttlMs) || params.ttlMs < 1 || params.ttlMs > 60_000)
  ) throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Credential lease lifetime is invalid");
  return {
    secret: credential,
    operationId: params.operationId,
    purpose: params.purpose,
    ...(params.ttlMs === undefined ? {} : { ttlMs: params.ttlMs }),
  };
}

class PluginCredentialBroker {
  constructor(options) {
    this.secretStore = options.secretStore;
    this.leaseStore = options.leaseStore;
    this.credentialResolver = options.credentialResolver ?? null;
    if (this.credentialResolver && (
      typeof this.credentialResolver.assertReference !== "function"
      || typeof this.credentialResolver.resolve !== "function"
    )) throw new TypeError("Credential resolver must validate and resolve credential references");
  }

  describeAuthorization(params) {
    const validated = assertLeaseParams(params);
    if (validated.secret.kind === "credential") {
      return {
        permission: "vault.credentials",
        resources: [`credential:${validated.secret.id}`],
        reason: `Use Netcatty credential for ${validated.purpose}`,
        operationId: validated.operationId,
      };
    }
    return {
      permission: "secrets",
      resources: [`secret:${validated.secret.key}`],
      reason: `Use plugin secret for ${validated.purpose}`,
      operationId: validated.operationId,
    };
  }

  async createLease(params, context) {
    const validated = assertLeaseParams(params);
    await context.assertActive();
    let resolveSecret;
    if (validated.secret.kind === "credential") {
      if (!this.credentialResolver) {
        throw new PluginRpcError(RPC_ERRORS.unavailable, "Netcatty credential access is unavailable");
      }
      await this.credentialResolver.assertReference(validated.secret, {
        pluginId: context.pluginId,
        runtimeId: context.runtimeId,
        operationId: validated.operationId,
        purpose: validated.purpose,
        signal: context.signal,
      });
      await context.assertActive();
      resolveSecret = async (consumeContext) => {
        const value = await this.credentialResolver.resolve(
          validated.secret,
          Object.freeze({ ...consumeContext, purpose: validated.purpose }),
        );
        if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
          throw new PluginRpcError(RPC_ERRORS.dataLoss, "Resolved credential is invalid or too large");
        }
        return value;
      };
    } else {
      this.secretStore.getRecordByReference(context.pluginId, validated.secret);
    }
    return this.leaseStore.issue({
      pluginId: context.pluginId,
      runtimeId: context.runtimeId,
      credential: validated.secret,
      operationId: validated.operationId,
      purpose: validated.purpose,
      ttlMs: validated.ttlMs,
      signal: context.signal,
      resolveSecret,
    });
  }

  async consumeLease(context, lease, operationId) {
    await context.assertActive();
    const value = await this.leaseStore.consume({
      pluginId: context.pluginId,
      runtimeId: context.runtimeId,
      lease,
      operationId,
      signal: context.signal,
    });
    await context.assertActive();
    return value;
  }
}

module.exports = { PluginCredentialBroker, assertCredentialRef, assertLeaseParams };
