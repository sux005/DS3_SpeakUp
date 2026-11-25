import type { HTMLAttributes, ReactNode } from "react";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

function Block({ className = "", ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton rounded-lg ${className}`} {...props} />;
}

function LoadingFrame({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={`flex w-full flex-col gap-8 ${className}`}>
      {children}
    </div>
  );
}

export function HomeSkeleton({ label = "Loading presentations" }: { label?: string }) {
  return (
    <LoadingFrame label={label}>
      <div className="relative z-10 flex w-full flex-col gap-5 rounded-2xl border-2 border-line bg-card p-6 md:flex-row md:items-end md:justify-between md:p-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Block className="h-3 w-36" />
          <Block className="h-9 w-3/4 max-w-md" />
          <Block className="h-5 w-full max-w-xl" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Block className="h-11 w-32 rounded-xl" />
          <Block className="h-11 w-44 rounded-xl" />
        </div>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Block className="h-8 w-56" />
        <div className="overflow-hidden rounded-2xl border-2 border-line bg-card">
          {["w-52", "w-64", "w-44"].map((width, index) => (
            <div key={index} className="flex items-center justify-between gap-4 border-t-2 border-line px-5 py-4 first:border-t-0">
              <Block className={`h-5 ${width}`} />
              <Block className="h-11 w-40 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </LoadingFrame>
  );
}

export function ProjectSkeleton() {
  return (
    <LoadingFrame label="Loading presentation">
      <div className="flex w-full flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-3">
          <Block className="h-3 w-40" />
          <Block className="h-11 w-72" />
          <Block className="h-5 w-64" />
        </div>
        <Block className="h-11 w-36 rounded-xl" />
      </div>
      <div className="w-full overflow-hidden rounded-2xl border-2 border-line bg-card">
        <Block className="m-5 h-8 w-48 md:m-7" />
        <div className="flex flex-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid gap-3 border-t-2 border-line px-5 py-5 md:grid-cols-4 md:gap-6 md:px-7">
              <Block className="h-5 w-24" />
              <Block className="h-5 w-36" />
              <Block className="h-5 w-44" />
              <Block className="h-11 w-28 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </LoadingFrame>
  );
}

export function NewAttemptSkeleton() {
  return (
    <LoadingFrame label="Loading recording form">
      <div className="flex flex-col gap-3">
        <Block className="h-3 w-48" />
        <Block className="h-11 w-72" />
        <Block className="h-5 w-full max-w-xl" />
      </div>
      <div data-surface="dark" className="flex w-full flex-col gap-8 rounded-3xl border-2 border-outline bg-night p-6 md:flex-row md:items-end md:p-10">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Block className="h-8 w-48 bg-night-soft" />
          <Block className="h-5 w-full max-w-xl bg-night-soft" />
          <Block className="h-28 w-full rounded-2xl bg-night-soft" />
        </div>
        <Block className="size-32 rounded-full bg-night-soft" />
      </div>
    </LoadingFrame>
  );
}

export function AnalyzingSkeleton() {
  return (
    <LoadingFrame label="Loading recording status">
      <div className="flex flex-col gap-3">
        <Block className="h-3 w-48" />
        <Block className="h-11 w-80" />
        <Block className="h-5 w-full max-w-xl" />
      </div>
      <div data-surface="dark" className="flex w-full flex-col gap-8 rounded-3xl border-2 border-outline bg-night p-6 md:flex-row md:gap-12 md:p-12">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {[0, 1, 2, 3].map((stage) => (
            <div key={stage} className="flex min-h-20 items-center gap-5 border-b border-night-line p-4 last:border-b-0">
              <Block className="size-10 shrink-0 rounded-full bg-night-soft" />
              <div className="flex flex-1 flex-col gap-2">
                <Block className="h-7 w-56 bg-night-soft" />
                <Block className="h-4 w-40 bg-night-soft" />
              </div>
            </div>
          ))}
        </div>
        <Block className="size-32 shrink-0 self-center rounded-full bg-night-soft md:size-40" />
      </div>
    </LoadingFrame>
  );
}

export function ResultsSkeleton() {
  return (
    <LoadingFrame label="Loading results">
      <div className="flex w-full flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-3">
          <Block className="h-3 w-48" />
          <Block className="h-11 w-64" />
          <Block className="h-5 w-40" />
        </div>
        <Block className="h-11 w-36 rounded-xl" />
      </div>
      <div className="w-full rounded-2xl border-2 border-line bg-pale p-6 md:p-8">
        <Block className="h-8 w-64" />
        <Block className="mt-4 h-5 w-full max-w-2xl" />
        <Block className="mt-2 h-5 w-3/4 max-w-xl" />
      </div>
      <div className="grid w-full gap-5 md:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className="rounded-2xl border-2 border-line bg-card p-5">
            <Block className="h-3 w-24" />
            <Block className="mt-4 h-12 w-28" />
            <Block className="mt-3 h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="h-48 w-full rounded-2xl border-2 border-line bg-card p-6"><Block className="h-6 w-48" /></div>
    </LoadingFrame>
  );
}

export function ReviewSkeleton() {
  return (
    <LoadingFrame label="Loading review details">
      <div className="w-full rounded-2xl border-2 border-line bg-pale p-6 md:p-8">
        <Block className="h-8 w-64" />
        <Block className="mt-4 h-5 w-full max-w-2xl" />
        <Block className="mt-2 h-5 w-3/4 max-w-xl" />
      </div>
      <div className="grid w-full gap-5 md:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className="rounded-2xl border-2 border-line bg-card p-5">
            <Block className="h-3 w-24" />
            <Block className="mt-4 h-12 w-28" />
            <Block className="mt-3 h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="h-48 w-full rounded-2xl border-2 border-line bg-card p-6"><Block className="h-6 w-48" /></div>
    </LoadingFrame>
  );
}
