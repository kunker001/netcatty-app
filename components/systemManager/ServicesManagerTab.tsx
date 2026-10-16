import {
  Play, RefreshCw, Square, Cog,
} from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import type { useSystemManagerBackend } from '../../application/state/useSystemManagerBackend';
import { usePolling, useStableTranslate } from '../../application/state/useSystemManager';
import { systemdUnitInfoEqual } from '../../domain/systemManager/pollEquals';
import type { SystemdUnitAction, SystemdUnitInfo } from '../../domain/systemManager/types';
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
type ServiceFilter = 'all' | 'running' | 'failed' | 'inactive';

interface PendingServiceAction {
  unit: SystemdUnitInfo;
  action: SystemdUnitAction;
}

const mergeUnits = (
  prev: SystemdUnitInfo[] | null,
  next: SystemdUnitInfo[],
) => mergePollListByKey(prev, next, (u) => `${u.scope}:${u.name}`, systemdUnitInfoEqual);

function activeTone(state: SystemdUnitInfo['activeState']): 'success' | 'warning' | 'muted' {
  if (state === 'active') return 'success';
  if (state === 'failed' || state === 'deactivating') return 'warning';
  return 'muted';
}

function actionTitleKey(action: SystemdUnitAction): string {
  switch (action) {
    case 'start': return 'systemManager.services.start';
    case 'stop': return 'systemManager.services.stop';
    case 'restart': return 'systemManager.services.restart';
    case 'enable': return 'systemManager.services.enable';
    case 'disable': return 'systemManager.services.disable';
    case 'reload': return 'systemManager.services.reload';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

interface ServicesManagerTabProps {
  sessionId: string;
  isVisible: boolean;
  backend: Backend;
  refreshIntervalSec: number;
  /** Network appliances: list only, no start/stop/restart. */
  allowMutations?: boolean;
}

export const ServicesManagerTab = memo(function ServicesManagerTab({
  sessionId,
  isVisible,
  backend,
  refreshIntervalSec,
  allowMutations = true,
}: ServicesManagerTabProps) {
  const { t } = useI18n();
  const stableT = useStableTranslate();
  const intervalMs = Math.max(3, refreshIntervalSec) * 1000;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ServiceFilter>('all');
  const [pending, setPending] = useState<PendingServiceAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listPending, setListPending] = useState(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    setListPending(false);
    setPending(null);
    setActionBusy(false);
    setActionError(null);
  }, [sessionId]);

  const fetcher = useCallback(async (): Promise<SystemdUnitInfo[] | null> => {
    const requestedSessionId = sessionId;
    try {
      const result = await backend.listSystemServices(requestedSessionId);
      if (sessionIdRef.current !== requestedSessionId) return null;
      if (result.pending) {
        setListPending(true);
        return null;
      }
      setListPending(false);
      if (!result.success) {
        throw new Error(result.error || stableT('systemManager.errors.loadServices'));
      }
      return result.units || [];
    } catch (error) {
      if (sessionIdRef.current === requestedSessionId) setListPending(false);
      throw error;
    }
  }, [backend, sessionId, stableT]);

  const { data, error, loading, refresh } = usePolling(
    fetcher,
    intervalMs,
    isVisible,
    mergeUnits,
    { resetKey: sessionId },
  );

  const isRefreshActive = loading || listPending;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data || []).filter((unit) => {
      if (filter === 'running' && unit.activeState !== 'active') return false;
      if (filter === 'failed' && unit.activeState !== 'failed') return false;
      if (filter === 'inactive' && unit.activeState !== 'inactive') return false;
      if (!q) return true;
      return (
        unit.name.toLowerCase().includes(q)
        || unit.description.toLowerCase().includes(q)
        || unit.subState.toLowerCase().includes(q)
        || unit.scope.toLowerCase().includes(q)
      );
    });
  }, [data, filter, query]);

  const units = useStableListOrder(
    filtered,
    (u) => `${u.scope}:${u.name}`,
    `${filter}|${query}`,
    (a, b) => {
      if (a.activeState === 'failed' && b.activeState !== 'failed') return -1;
      if (b.activeState === 'failed' && a.activeState !== 'failed') return 1;
      return a.name.localeCompare(b.name);
    },
  );

  const executeAction = useCallback(async (unit: SystemdUnitInfo, action: SystemdUnitAction) => {
    const requestedSessionId = sessionId;
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await backend.systemServiceAction({
        sessionId: requestedSessionId,
        unitName: unit.name,
        action,
        scope: unit.scope,
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
      if (sessionIdRef.current === requestedSessionId) setActionBusy(false);
    }
  }, [backend, refresh, sessionId, t]);

  return (
    <SystemPanelShell section="system-manager-services">
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
          placeholder={t('systemManager.services.search')}
        />
      </SystemPanelToolbar>

      <SystemPanelSegmented
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: t('systemManager.services.filter.all') },
          { id: 'running', label: t('systemManager.services.filter.running') },
          { id: 'failed', label: t('systemManager.services.filter.failed') },
          { id: 'inactive', label: t('systemManager.services.filter.inactive') },
        ]}
      />

      <SystemPanelMetaBar>
        {t('systemManager.services.meta', { count: units.length })}
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
        <SystemPanelLoading message={t('systemManager.services.loading')} />
      ) : !units.length ? (
        <SystemPanelEmpty icon={Cog} message={t('systemManager.services.empty')} />
      ) : (
        <SystemPanelList>
          {units.map((unit) => {
            const isActive = unit.activeState === 'active';
            return (
              <SystemPanelRow
                key={`${unit.scope}:${unit.name}`}
                title={unit.name}
                subtitle={
                  unit.description
                    ? `${unit.description}${unit.scope === 'user' ? ` · ${t('systemManager.services.scope.user')}` : ''}`
                    : (unit.scope === 'user' ? t('systemManager.services.scope.user') : unit.subState)
                }
                trailing={(
                  <SystemPanelStatusBadge tone={activeTone(unit.activeState)}>
                    {unit.activeState}
                  </SystemPanelStatusBadge>
                )}
                actions={allowMutations ? (
                  <div className="flex shrink-0 items-center justify-end gap-1">
                    {!isActive ? (
                      <SystemPanelRoundButton
                        title={t('systemManager.services.start')}
                        onClick={() => setPending({ unit, action: 'start' })}
                      >
                        <Play size={12} />
                      </SystemPanelRoundButton>
                    ) : (
                      <SystemPanelRoundButton
                        title={t('systemManager.services.stop')}
                        onClick={() => setPending({ unit, action: 'stop' })}
                      >
                        <Square size={12} />
                      </SystemPanelRoundButton>
                    )}
                    <SystemPanelRoundButton
                      title={t('systemManager.services.restart')}
                      onClick={() => setPending({ unit, action: 'restart' })}
                    >
                      <RefreshCw size={12} />
                    </SystemPanelRoundButton>
                  </div>
                ) : null}
              />
            );
          })}
        </SystemPanelList>
      )}

      <SystemPanelConfirmDialog
        open={allowMutations && pending !== null}
        title={pending ? t(actionTitleKey(pending.action)) : ''}
        message={pending
          ? t('systemManager.services.confirmAction', {
            action: t(actionTitleKey(pending.action)),
            name: pending.unit.name,
          })
          : ''}
        confirmLabel={pending ? t(actionTitleKey(pending.action)) : ''}
        destructive={pending?.action === 'stop' || pending?.action === 'disable'}
        busy={actionBusy}
        onOpenChange={(open) => {
          if (!open && !actionBusy) setPending(null);
        }}
        onConfirm={() => {
          const target = pending;
          if (!target) return;
          setPending(null);
          void executeAction(target.unit, target.action);
        }}
      />
    </SystemPanelShell>
  );
});
