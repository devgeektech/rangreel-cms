"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function StatCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="rounded-xl border border-border p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, colIdx) => (
            <Skeleton key={`${rowIdx}-${colIdx}`} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function RoleCardsSkeleton({ count = 6 }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="rounded-xl border border-border p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-3 h-4 w-1/3" />
          <Skeleton className="mt-4 h-12 w-full" />
          <Skeleton className="mt-3 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
