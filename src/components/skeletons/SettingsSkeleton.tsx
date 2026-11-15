import { SkeletonBlock, SkeletonRegion } from "@/components/Skeleton";

/**
 * Risk settings while the saved values are being fetched.
 *
 * Both panels keep their real column spans, padding and inner block heights, and
 * the save/send row is held at its real height too, so nothing jumps when the
 * form replaces the placeholder.
 */
export function SettingsSkeleton() {
  return (
    <SkeletonRegion label="Loading risk settings">
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="surface p-5 sm:p-7 lg:col-span-7 lg:min-h-[430px]">
          <div className="flex items-start gap-3">
            <SkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <SkeletonBlock className="h-2.5 w-28 rounded-full" />
              <SkeletonBlock className="mt-2 h-7 w-64 max-w-full rounded-lg" />
              <SkeletonBlock className="mt-2 h-2.5 w-72 max-w-full rounded-full" />
            </div>
          </div>

          <div className="mt-10 rounded-2xl bg-slate-50 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <SkeletonBlock className="h-3 w-24 rounded-full" />
              <SkeletonBlock className="h-10 w-24 rounded-lg" />
            </div>
            <SkeletonBlock className="mt-6 h-2 w-full rounded-full" />
            <div className="mt-2 flex justify-between">
              <SkeletonBlock className="h-2 w-10 rounded-full" />
              <SkeletonBlock className="h-2 w-10 rounded-full" />
              <SkeletonBlock className="h-2 w-10 rounded-full" />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3.5">
            <div>
              <SkeletonBlock className="h-3 w-24 rounded-full" />
              <SkeletonBlock className="mt-2 h-2.5 w-40 rounded-full" />
            </div>
            <SkeletonBlock className="h-4 w-14 shrink-0 rounded-full" />
          </div>
        </div>

        <div className="surface p-5 sm:p-7 lg:col-span-5 lg:min-h-[570px]">
          <div className="flex items-start gap-3">
            <SkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <SkeletonBlock className="h-2.5 w-24 rounded-full" />
              <SkeletonBlock className="mt-2 h-7 w-40 max-w-full rounded-lg" />
              <SkeletonBlock className="mt-2 h-2.5 w-56 max-w-full rounded-full" />
            </div>
          </div>

          <div className="mt-7 space-y-5">
            {[0, 1].map((field) => (
              <div key={field}>
                <SkeletonBlock className="mb-2 h-3 w-40 rounded-full" />
                <SkeletonBlock className="h-[46px] w-full rounded-xl" />
                <SkeletonBlock className="mt-2 h-2.5 w-56 max-w-full rounded-full" />
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3.5">
              <div>
                <SkeletonBlock className="h-3 w-28 rounded-full" />
                <SkeletonBlock className="mt-2 h-2.5 w-40 rounded-full" />
              </div>
              <SkeletonBlock className="h-4 w-8 shrink-0 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SkeletonBlock className="h-2.5 w-72 max-w-full rounded-full" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <SkeletonBlock className="h-11 w-full rounded-xl sm:w-40" />
          <SkeletonBlock className="h-11 w-full rounded-xl sm:w-36" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
