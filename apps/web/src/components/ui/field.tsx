import type { ComponentProps } from 'react';

interface FieldProps extends ComponentProps<'input'> {
  readonly label: string;
  readonly hint?: string;
  readonly errors?: readonly string[];
}

export function Field({ label, hint, errors, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? rest.name;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-text">
        {label}
      </label>

      <input
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : hint ? hintId : undefined}
        className={`h-10 w-full rounded-lg border bg-surface px-3 text-sm text-text placeholder:text-text-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
          hasError ? 'border-danger' : 'border-border-strong hover:border-text-muted'
        } ${className}`}
        {...rest}
      />

      {hasError ? (
        <p id={errorId} className="text-xs text-danger">
          {errors![0]}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
