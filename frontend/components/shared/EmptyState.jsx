"use client";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  onCta,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
      {Icon ? (
        <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {ctaLabel && onCta ? (
        <button
          type="button"
          onClick={onCta}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
