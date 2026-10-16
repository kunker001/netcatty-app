import { cn } from '../../lib/utils';
import type { ComponentProps, HTMLAttributes } from 'react';
import { forwardRef } from 'react';

export type InputGroupProps = HTMLAttributes<HTMLDivElement>;

export const InputGroup = forwardRef<HTMLDivElement, InputGroupProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col rounded-xl border border-border/65 bg-background transition-[border-color,background-color]',
        'focus-within:border-primary/45 focus-within:ring-1 focus-within:ring-primary/20',
        'overflow-hidden',
        className,
      )}
      {...props}
    />
  ),
);
InputGroup.displayName = 'InputGroup';

export type InputGroupTextareaProps = ComponentProps<'textarea'>;

export const InputGroupTextarea = forwardRef<HTMLTextAreaElement, InputGroupTextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none bg-transparent text-[13px] text-foreground/92 selection:bg-primary/25',
        'placeholder:text-muted-foreground/62 placeholder:font-medium placeholder:text-[13px]',
        'focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed',
        'px-4 pt-3.5 pb-2 leading-[20px]',
        'field-sizing-content min-h-[82px] max-h-52',
        className,
      )}
      {...props}
    />
  ),
);
InputGroupTextarea.displayName = 'InputGroupTextarea';

export type InputGroupAddonProps = HTMLAttributes<HTMLDivElement> & {
  align?: 'block-start' | 'block-end';
};

export const InputGroupAddon = forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ className, align = 'block-end', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center px-2.5 py-1.5',
        align === 'block-start' && 'border-b border-border/35 bg-muted/8',
        align === 'block-end' && 'border-t border-border/60 bg-muted/10',
        className,
      )}
      {...props}
    />
  ),
);
InputGroupAddon.displayName = 'InputGroupAddon';

export type InputGroupButtonProps = ComponentProps<'button'> & {
  variant?: 'default' | 'ghost' | 'outline' | 'destructive';
  size?: 'sm' | 'icon-sm' | 'default';
};

export const InputGroupButton = forwardRef<HTMLButtonElement, InputGroupButtonProps>(
  ({ className, variant = 'ghost', size = 'icon-sm', disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors cursor-pointer',
        'disabled:opacity-30 disabled:cursor-default',
        size === 'icon-sm' && 'h-7 w-7',
        size === 'sm' && 'h-7 px-2 text-[12px] gap-1',
        size === 'default' && 'h-8 px-3 text-[13px] gap-1.5',
        variant === 'ghost' && 'text-muted-foreground/78 hover:text-foreground hover:bg-muted/45',
        variant === 'default' && 'bg-primary/80 text-primary-foreground hover:bg-primary',
        variant === 'outline' && 'border border-border/40 text-muted-foreground/85 hover:text-foreground hover:bg-muted/35',
        variant === 'destructive' && 'text-destructive/70 hover:text-destructive hover:bg-destructive/10',
        className,
      )}
      {...props}
    />
  ),
);
InputGroupButton.displayName = 'InputGroupButton';
