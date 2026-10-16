import type { ReactNode } from 'react';

/**
 * Owns dialog / queue / ephemeral React state for the main window.
 *
 * The concrete state currently lives in `AppSideEffects` (same React tree)
 * and is published into `appLocalUiStore` for Host islands. This provider is
 * the composition slot the architecture requires so App itself never owns
 * domain bags or mega-hook subscriptions.
 */
export function AppLocalStateProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
