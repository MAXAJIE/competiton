import { SkeletonBlock, SkeletonRegion, SkeletonText } from "@/components/Skeleton";

/**
 * Overview page while the ledger is still loading.
 *
 * Mirrors the three resolved sections (cash + metrics, chart + aging, next step
 * + market) using the same wrappers, spans, paddings and fixed heights, so the
 * page does not move when the numbers arrive.
 */
export function OverviewSkeleton() {
  return (
    <SkeletonRegion label="Loading your financial overview">
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="relative min-h-[332px] overflow-hidden rounded-3xl bg-[#172641] p-6 sm:p-8 lg:col-span-5">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="skeleton-inverse h-2.5 w-24 rounded-full" />
            <SkeletonBlock className="skeleton-inverse h-9 w-9 rounded-xl" />
          </div>
          <SkeletonBlock className="skeleton-inverse mt-8 h-10 w-40 rounded-xl sm:h-12" />
          <div className="mt-8 border-t border-white/15 pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <SkeletonBlock className="skeleton-inverse h-2.5 w-20 rounded-full" />
                <SkeletonBlock className="skeleton-inverse mt-2 h-6 w-16 rounded-lg" />
              </div>
              <SkeletonBlock className="skeleton-inverse h-9 w-9 rounded-full" />
            </div>
            <SkeletonBlock className="skeleton-inverse mt-4 h-1.5 w-full rounded-full" />
            <SkeletonBlock className="skeleton-inverse mt-3 h-2.5 w-36 rounded-full" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-7">
          {[0, 1, 2].map((item) => (
            <div key={item} className="surface flex min-h-48 flex-col p-5">
              <div className="flex items-center justify-between gap-2">
                <SkeletonBlock className="h-2.5 w-24 rounded-full" />
                <SkeletonBlock className="h-9 w-9 rounded-xl" />
              </div>
              <SkeletonBlock className="mt-5 h-7 w-28 rounded-lg" />
              <SkeletonBlock className="mt-auto h-2.5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-12">
        <div className="surface min-w-0 p-5 sm:p-7 xl:col-span-8 xl:min-h-[490px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SkeletonBlock className="h-2.5 w-24 rounded-full" />
              <SkeletonBlock className="mt-2 h-8 w-56 rounded-lg" />
              <SkeletonBlock className="mt-2 h-2.5 w-64 rounded-full" />
            </div>
            <div className="flex gap-4 pt-1">
              <SkeletonBlock className="h-2.5 w-16 rounded-full" />
              <SkeletonBlock className="h-2.5 w-16 rounded-full" />
            </div>
          </div>
          {/* Fixed 280px like the real chart body: gridlines plus an area-shaped
              fill, so the placeholder reads as the chart it replaces. */}
          <div className="relative mt-6 h-[280px] overflow-hidden rounded-2xl bg-slate-50/60">
            {[22, 46, 70].map((top) => (
              <SkeletonBlock
                key={top}
                className="absolute left-4 right-4 h-px rounded-full opacity-80"
                style={{ top: `${top}%` }}
              />
            ))}
            <div className="absolute bottom-4 left-4 right-4 flex items-end gap-1.5">
              {[38, 58, 44, 76, 52, 66, 48].map((height, index) => (
                <SkeletonBlock
                  key={index}
                  className="w-full rounded-t-lg"
                  style={{ height: `${height * 1.2}px` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="surface p-5 sm:p-7 xl:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <SkeletonBlock className="h-2.5 w-20 rounded-full" />
              <SkeletonBlock className="mt-2 h-8 w-24 rounded-lg" />
            </div>
            <SkeletonBlock className="h-6 w-16 rounded-full" />
          </div>
          <div className="mt-7 space-y-5">
            {[0, 1, 2, 3].map((item) => (
              <div key={item}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <SkeletonBlock className="h-2.5 w-24 rounded-full" />
                  <SkeletonBlock className="h-2.5 w-14 rounded-full" />
                </div>
                <SkeletonBlock className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            <SkeletonBlock className="h-2.5 w-32 rounded-full" />
            <SkeletonBlock className="h-3 w-16 rounded-full" />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="surface min-h-[228px] p-5 sm:p-7 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <SkeletonBlock className="h-2.5 w-24 rounded-full" />
              <SkeletonBlock className="mt-2 h-8 w-48 rounded-lg" />
            </div>
            <SkeletonBlock className="h-10 w-10 rounded-xl" />
          </div>
          <SkeletonText lines={3} className="mt-4" />
          <SkeletonBlock className="mt-5 h-2.5 w-40 rounded-full" />
        </div>

        <div className="surface min-h-[228px] p-5 sm:p-7 lg:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SkeletonBlock className="h-2.5 w-28 rounded-full" />
              <SkeletonBlock className="mt-2 h-8 w-52 rounded-lg" />
              <SkeletonBlock className="mt-2 h-2.5 w-60 rounded-full" />
            </div>
            <SkeletonBlock className="h-6 w-24 rounded-full" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3"
              >
                <SkeletonBlock className="h-2.5 w-20 rounded-full" />
                <SkeletonBlock className="mt-2 h-4 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </SkeletonRegion>
  );
}
