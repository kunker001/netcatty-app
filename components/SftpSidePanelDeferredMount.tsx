import React, { startTransition, useEffect } from 'react';

type SftpSidePanelDeferredMountProps = {
  children: React.ReactNode;
  ready: boolean;
  onReady: () => void;
};

export const SftpSidePanelDeferredMount: React.FC<SftpSidePanelDeferredMountProps> = ({
  children,
  ready,
  onReady,
}) => {
  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;
      startTransition(() => onReady());
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [ready, onReady]);

  if (!ready) {
    return (
      <div className="absolute inset-0 z-10 flex h-full items-center justify-center bg-background text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
};
