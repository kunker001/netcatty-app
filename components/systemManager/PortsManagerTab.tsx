import { Network, Skull } from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import type { useSystemManagerBackend } from '../../application/state/useSystemManagerBackend';
import { usePolling, useStableTranslate } from '../../application/state/useSystemManager';
import { listeningPortInfoEqual } from '../../domain/systemManager/pollEquals';
import type { ListeningPortInfo } from '../../domain/systemManager/types';
import { SystemPanelConfirmDialog } from './SystemPanelConfirmDialog';
import { mergePollListByKey, useStableListOrder } from './listStable';
import {
  SystemPanelEmpty,
  SystemPanelError,
  SystemPanelInlineError,
  SystemPanelList,
  SystemPanelLoading,
  SystemPanelMetaBar,
  SystemPanelRefreshButton,
  SystemPanelRoundButton,
  SystemPanelRow,
  SystemPanelSearch,
  SystemPanelSegmented,
  SystemPanelShell,
  SystemPanelStatusBadge,
  SystemPanelToolbar,
} from './SystemPanelUi';

type Backend = ReturnType<typeof useSystemManagerBackend>;
type PortFilter = 'all' | 'tcp' | 'udp';

const mergePorts = (
  prev: ListeningPortInfo[] | null,
  next: ListeningPortInfo[],
) => mergePollListByKey(prev, next, (p) => p.id, listeningPortInfoEqual);

interface PortsManagerTabProps {
  sessionId: string;
  isVisible: boolean;
  backend: Backend;
  refreshIntervalSec: number;
  /** Network appliances: list only, no process terminate. */
  allowMutations?: boolean;
}

export const PortsManagerTab = memo(function PortsManagerTab({
  sessionId,
  isVisible,
  backend,
  refreshIntervalSec,
  allowMutations = true,
}: PortsManagerTabProps) {
  const { t } = useI18n();
  const stableT = useStableTranslate();
  const intervalMs = Math.max(2, refreshIntervalSec) * 1000;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PortFilter>('all');
  const [pendingKillPid, setPendingKillPid] = useState<number | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listPending, setListPending] = useState(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    setListPending(false);
    setPendingKillPid(null);
    setKillBusy(false);
    setActionError(null);
  }, [sessionId]);

  const fetcher = useCallback(async (): Promise<ListeningPortInfo[] | null> => {
    const requestedSessionId = sessionId;
    try {
      const result = await backend.listListeningPorts(requestedSessionId);
      if (sessionIdRef.current !== requestedSessionId) return null;
      if (result.pending) {
        setListPending(true);
        return null;
      }
      setListPending(false);
      if (!result.success) {
        throw new Error(result.error || stableT('systemManager.errors.loadPorts'));
      }
      return result.ports || [];
    } catch (error) {
      if (sessionIdRef.current === requestedSessionId) setListPending(false);
      throw error;
    }
  }, [backend, sessionId, stableT]);

  const { data, error, loading, refresh } = usePolling(
    fetcher,
    intervalMs,
    isVisible,
    mergePorts,
    { resetKey: sessionId },
  );

  const isRefreshActive = loading || listPending;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data || []).filter((port) => {
      if (filter === 'tcp' && !port.protocol.startsWith('tcp')) return false;
      if (filter === 'udp' && !port.protocol.startsWith('udp')) return false;
      if (!q) return true;
      return (
        String(port.port).includes(q)
        || port.address.toLowerCase().includes(q)
        || port.processName.toLowerCase().includes(q)
        || (port.pid != null && String(port.pid).includes(q))
        || port.protocol.toLowerCase().includes(q)
      );
    });
  }, [data, filter, query]);

  const ports = useStableListOrder(
    filtered,
    (p) => p.id,
    `${filter}|${query}`,
    (a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol),
  );

  const executeTerminate = useCallback(async (pid: number) => {
    const requestedSessionId = sessionId;
    setKillBusy(true);
    setActionError(null);
    try {
      const result = await backend.signalSystemProcess({
        sessionId: requestedSessionId,
        pid,
        signal: 'TERM',
      });
      if (sessionIdRef.current !== requestedSessionId) return;
      if (result.pending) {
        setActionError(t('systemManager.errors.sshChannelUnavailable'));
        return;
      }
      if (!result.success) {
        setActionError(result.error || t('systemManager.errors.actionFailed'));
        return;
      }
      void refresh();
    } finally {
      if (sessionIdRef.current === requestedSessionId) setKillBusy(false);
    }
  }, [backend, refresh, sessionId, t]);

  return (
    <SystemPanelShell section="system-manager-ports">
      <SystemPanelToolbar
        trailing={(
          <SystemPanelRefreshButton
            title={t('history.action.refresh')}
            loading={isRefreshActive}
            onClick={() => void refresh()}
          />
        )}
      >
        <SystemPanelSearch
          value={query}
          onChange={setQuery}
          placeholder={t('systemManager.ports.search')}
        />
      </SystemPanelToolbar>

      <SystemPanelSegmented
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: t('systemManager.ports.filter.all') },
          { id: 'tcp', label: 'TCP' },
          { id: 'udp', label: 'UDP' },
        ]}
      />

      <SystemPanelMetaBar>
        {t('systemManager.ports.meta', { count: ports.length })}
      </SystemPanelMetaBar>

      {actionError ? <SystemPanelInlineError message={actionError} /> : null}

      {error && !(data?.length) ? (
        <SystemPanelError
          message={error}
          onRetry={() => void refresh()}
          retryLabel={t('history.action.retry')}
          loading={loading}
        />
      ) : !(data?.length) && (loading || listPending) ? (
        <SystemPanelLoading message={t('systemManager.ports.loading')} />
      ) : !ports.length ? (
        <SystemPanelEmpty icon={Network} message={t('systemManager.ports.empty')} />
      ) : (
        <SystemPanelList>
          {ports.map((port) => (
            <SystemPanelRow
              key={port.id}
              title={`${port.address}:${port.port}`}
              subtitle={
                port.processName
                  ? `${port.processName}${port.pid != null ? ` · PID ${port.pid}` : ''}`
                  : (port.pid != null ? `PID ${port.pid}` : t('systemManager.ports.unknownProcess'))
              }
              trailing={(
                <SystemPanelStatusBadge tone="muted">
                  {port.protocol.toUpperCase()}
                </SystemPanelStatusBadge>
              )}
              actions={allowMutations && port.pid != null ? (
                <SystemPanelRoundButton
                  title={t('systemManager.ports.terminate')}
                  destructive
                  onClick={() => setPendingKillPid(port.pid)}
                >
                  <Skull size={12} />
                </SystemPanelRoundButton>
              ) : null}
            />
          ))}
        </SystemPanelList>
      )}

      <SystemPanelConfirmDialog
        open={allowMutations && pendingKillPid != null}
        title={t('systemManager.ports.terminate')}
        message={t('systemManager.ports.confirmTerminate', { pid: String(pendingKillPid ?? 0) })}
        confirmLabel={t('systemManager.ports.terminate')}
        destructive
        busy={killBusy}
        onOpenChange={(open) => {
          if (!open && !killBusy) setPendingKillPid(null);
        }}
        onConfirm={() => {
          const pid = pendingKillPid;
          if (pid == null) return;
          setPendingKillPid(null);
          void executeTerminate(pid);
        }}
      />
    </SystemPanelShell>
  );
});
