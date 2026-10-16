import * as React from "react";
import { cn } from "../../lib/utils";
import { Button, ButtonProps } from "./button";

interface RippleState {
  id: number;
  x: number;
  y: number;
  size: number;
}

const RIPPLE_DURATION_MS = 600;

export const RippleButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className, onPointerDown, ...props }, ref) => {
    const [ripples, setRipples] = React.useState<RippleState[]>([]);
    const nextId = React.useRef(0);

    const handlePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        const id = nextId.current++;
        setRipples((rs) => [...rs, { id, x, y, size }]);
        window.setTimeout(
          () => setRipples((rs) => rs.filter((r) => r.id !== id)),
          RIPPLE_DURATION_MS,
        );
        onPointerDown?.(e);
      },
      [onPointerDown],
    );

    return (
      <Button
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        onPointerDown={handlePointerDown}
        {...props}
      >
        {children}
        <span className="pointer-events-none absolute inset-0">
          {ripples.map((r) => (
            <span
              key={r.id}
              className="absolute rounded-full bg-current"
              style={{
                left: r.x,
                top: r.y,
                width: r.size,
                height: r.size,
                animation: `ripple ${RIPPLE_DURATION_MS}ms ease-out forwards`,
              }}
            />
          ))}
        </span>
      </Button>
    );
  },
);
RippleButton.displayName = "RippleButton";
