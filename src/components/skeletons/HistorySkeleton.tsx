import { SkeletonBlock, SkeletonRegion } from "@/components/Skeleton";

/**
 * History page placeholders.
 *
 * The totals row and the ledger list load at different moments in the real page,
 * so they are separate skeletons: the list has both a desktop table and the
 * mobile card list, and each mirrors its resolved row height.
 */

export function HistoryTotalsSkeleton() {
  return (
    <SkeletonRegion
      label="Loading ledger totals"
      className="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4"
    >
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="surface min-h-[118px] rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <SkeletonBlock className="h-3 w-24 rounded-full" />
            <SkeletonBlock className="h-8 w-8 rounded-xl" />
          </div>
          <SkeletonBlock className="mt-3 h-6 w-20 rounded-lg" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

const HEADER_CELLS = ["w-12", "w-32", "w-14", "w-16", "ml-auto w-16"];

export function HistoryListSkeleton() {
  return (
    <SkeletonRegion label="Loading transaction history">
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-slate-50/80">
            <tr>
              {HEADER_CELLS.map((width, index) => (
                <th key={index} scope="col" className="px-5 py-4">
                  <SkeletonBlock className={`h-2.5 rounded-full ${width}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <tr key={row}>
                <td className="whitespace-nowrap px-5 py-4">
                  <SkeletonBlock className="h-3 w-20 rounded-full" />
                </td>
                <td className="max-w-[300px] px-5 py-4">
                  <SkeletonBlock className="h-3.5 w-40 rounded-full" />
                  <SkeletonBlock className="mt-2 h-2.5 w-24 rounded-full" />
                </td>
                <td className="px-5 py-4">
                  <SkeletonBlock className="h-6 w-16 rounded-full" />
                </td>
                <td className="px-5 py-4">
                  <SkeletonBlock className="h-6 w-20 rounded-full" />
                </td>
                <td className="px-5 py-4">
                  <SkeletonBlock className="ml-auto h-3.5 w-16 rounded-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 sm:hidden">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SkeletonBlock className="h-3.5 w-40 rounded-full" />
                <SkeletonBlock className="mt-2 h-2.5 w-24 rounded-full" />
              </div>
              <SkeletonBlock className="h-3.5 w-16 shrink-0 rounded-full" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SkeletonBlock className="h-3 w-20 rounded-full" />
              <SkeletonBlock className="h-6 w-16 rounded-full" />
              <SkeletonBlock className="h-6 w-20 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}
