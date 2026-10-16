import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../application/i18n/I18nProvider';
import {
  pluginAuthenticationChallengeMessage,
  usePluginAuthenticationChallenges,
} from '../../application/state/usePluginAuthenticationChallenges';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export const PluginAuthenticationHost: React.FC = () => {
  const { t } = useI18n();
  const state = usePluginAuthenticationChallenges();
  const { challenge, busy, externalUrl } = state;

  if (!challenge) return null;
  const message = pluginAuthenticationChallengeMessage(challenge);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void state.complete(undefined, true); }}>
      <DialogContent className="sm:max-w-[480px]" hideCloseButton>
        <DialogHeader>
          <DialogTitle>{challenge.title}</DialogTitle>
          <DialogDescription>
            {message || t('plugins.authentication.description')}
          </DialogDescription>
        </DialogHeader>

        {state.isText && (
          <div className="space-y-2">
            <Label htmlFor="plugin-authentication-value">
              {challenge.kind === 'otp'
                ? t('plugins.authentication.code')
                : challenge.kind === 'password'
                  ? t('plugins.authentication.password')
                  : t('plugins.authentication.value')}
            </Label>
            <Input
              id="plugin-authentication-value"
              type={challenge.kind === 'password' ? 'password' : 'text'}
              autoComplete={challenge.kind === 'password' ? 'current-password' : challenge.kind === 'otp' ? 'one-time-code' : 'off'}
              value={state.textValue}
              maxLength={8192}
              disabled={busy}
              onChange={(event) => state.setTextValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && state.canSubmit) state.submit(); }}
              autoFocus
            />
          </div>
        )}

        {challenge.kind === 'choice' && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {challenge.choices.map((choice) => {
              const selected = state.selectedChoices.includes(choice.id);
              return (
                <label key={choice.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <input
                    type={challenge.multiple ? 'checkbox' : 'radio'}
                    name="plugin-authentication-choice"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={selected}
                    disabled={busy}
                    onChange={(event) => state.setChoiceSelected(choice.id, event.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{choice.label}</span>
                    {choice.description && <span className="block text-xs text-muted-foreground">{choice.description}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {(challenge.kind === 'browser' || challenge.kind === 'deviceCode') && (
          <div className="space-y-3 rounded-md border p-3">
            {challenge.kind === 'deviceCode' && (
              <div>
                <div className="text-xs text-muted-foreground">{t('plugins.authentication.deviceCode')}</div>
                <code className="select-all text-base font-semibold">{challenge.userCode}</code>
              </div>
            )}
            {externalUrl ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => void state.openExternal()}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('plugins.authentication.openBrowser')}
              </Button>
            ) : (
              <p className="text-sm text-destructive">{t('plugins.authentication.invalidUrl')}</p>
            )}
          </div>
        )}

        {state.responseError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {state.responseError
              ? t('plugins.authentication.responseFailedWithMessage', { message: state.responseError })
              : t('plugins.authentication.responseFailed')}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void (challenge.kind === 'confirmation'
              ? state.complete(false)
              : state.complete(undefined, true))}
          >
            {challenge.kind === 'confirmation' && challenge.cancelLabel
              ? challenge.cancelLabel
              : t('common.cancel')}
          </Button>
          {challenge.kind === 'confirmation' ? (
            <Button type="button" disabled={busy} onClick={() => void state.complete(true)}>
              {challenge.confirmLabel || t('common.confirm')}
            </Button>
          ) : (
            <Button type="button" disabled={busy || !state.canSubmit} onClick={state.submit}>
              {challenge.kind === 'browser' || challenge.kind === 'deviceCode'
                ? t('plugins.authentication.continue')
                : t('common.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
