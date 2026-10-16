import { memo } from 'react';

import { useI18n } from '../i18n/I18nProvider';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { PortForwardHostKeyDialog } from '../../components/port-forwarding';
import { AppActiveTabChrome } from './AppActiveTabChrome';
import { AppView } from './AppView';
import {
  useAppShellProps,
  type AppShellOverlays,
} from './appShellPropsStore';
import { ChromeHost } from './hosts/ChromeHost';
import { DialogsHost } from './hosts/DialogsHost';
import { TerminalHost } from './hosts/TerminalHost';
import { VaultHost } from './hosts/VaultHost';

export type { AppShellOverlays };

/**
 * The rendered main window. Host islands subscribe to stores and publish
 * domain / chrome / overlay bags into `appShellPropsStore`; this shell only
 * re-renders when those bag identities change (see `appViewDomainsEqual` /
 * chrome / overlays identity checks in the store).
 *
 * Default `memo` is enough: AppShell takes no props, so parent App updates
 * do not force a re-render; store subscriptions via `useAppShellProps` still
 * drive updates when Hosts publish new bag identities.
 *
 * `AppShell.architecture.test.ts` enforces Host composition and that the
 * three mega hooks never reappear here.
 */
function AppShellView() {
  const { t } = useI18n();
  const { domains, chrome, overlays } = useAppShellProps();

  return (
    <>
      <VaultHost />
      <TerminalHost />
      <ChromeHost />
      <DialogsHost />
      {domains && chrome && overlays ? (
        <>
          <PortForwardHostKeyDialog onAddKnownHost={overlays.onAddKnownHost} />
          <ConfirmDialog
            open={overlays.deleteHostConfirm !== null}
            title={
              overlays.deleteHostConfirm
                ? t('confirm.deleteHost', { name: overlays.deleteHostConfirm.name })
                : ''
            }
            confirmLabel={t('action.delete')}
            destructive
            onOpenChange={(open) => {
              if (!open) overlays.onCancelDeleteHost();
            }}
            onConfirm={overlays.onConfirmDeleteHost}
          />
          <AppActiveTabChrome {...chrome} />
          <AppView domains={domains} />
        </>
      ) : null}
    </>
  );
}

export const AppShell = memo(AppShellView);
AppShell.displayName = 'AppShell';
