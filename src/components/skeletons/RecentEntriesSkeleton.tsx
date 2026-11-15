import { SkeletonBlock, SkeletonRegion } from "@/components/Skeleton";

/**
 * "Recent entries" list on the entry page while the ledger is loading. The rows
 * use the resolved row padding and icon size, so the card does not change height
 * once the real transactions arrive.
 */
export function RecentEntriesSkeleton() {
  return (
    <SkeletonRegion label="Loading recent entries" className="mt-4">
      <ul className="divide-y divide-slate-100">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-center justify-between gap-3 py-3 first:pt-1">
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonBlock className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="min-w-0">
                <SkeletonBlock className="h-3.5 w-36 max-w-full rounded-full" />
                <SkeletonBlock className="mt-1.5 h-2.5 w-24 rounded-full" />
              </div>
            </div>
            <SkeletonBlock className="h-3 w-14 shrink-0 rounded-full" />
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}
