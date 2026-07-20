"use client";

/** 简单翻页控件：上一页 / 第 X / Y 页（共 N 条）/ 下一页。 */
export default function Pagination({
  page, totalPages, total, onChange,
}: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between text-sm text-slate-500 px-1">
      <span>共 {total} 条</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="px-3 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent">
          上一页
        </button>
        <span>第 {page} / {Math.max(totalPages, 1)} 页</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
          className="px-3 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent">
          下一页
        </button>
      </div>
    </div>
  );
}
