import { Clock3, LockKeyhole, Megaphone } from "lucide-react";

import type { NoticeRow } from "../lib/database.types";
import {
  formatCentralDateTime,
  formatDth,
  formatMoneyCents,
  formatPercent,
} from "../lib/format";

interface NoticeBannerProps {
  notice: NoticeRow | null;
}

export function NoticeBanner({ notice }: NoticeBannerProps) {
  if (!notice) return null;
  const posted = notice.status === "posted";

  return (
    <section
      className={`overflow-hidden rounded-[14px] border ${
        posted
          ? "border-emerald-400/25 bg-emerald-400/[0.055]"
          : "border-amber-300/25 bg-amber-300/[0.05]"
      }`}
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              posted ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-300/10 text-amber-200"
            }`}
          >
            <Megaphone size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${
                  posted ? "bg-emerald-400/12 text-emerald-200" : "bg-amber-300/12 text-amber-200"
                }`}
              >
                {posted ? "Posted notice" : "Draft · approval required"}
              </span>
              <span className="mono text-[9px] text-[#738a82]">{notice.notice_type.toUpperCase()}</span>
            </div>
            <h2 className="mt-1.5 truncate text-sm font-semibold text-[#eef5f2]">{notice.headline}</h2>
            <p className="mt-1 line-clamp-1 text-[10px] text-[#879c94]">{notice.body_text}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:justify-end">
          <div>
            <span className="eyebrow">Constraint</span>
            <div className="mono mt-1 text-[11px] font-semibold text-[#c9d8d3]">
              {formatDth(notice.derate_to_dth)} Dth
            </div>
          </div>
          <div>
            <span className="eyebrow">Tolerance</span>
            <div className="mono mt-1 text-[11px] font-semibold text-[#c9d8d3]">
              ±{formatPercent(notice.tolerance_pct)}
            </div>
          </div>
          <div>
            <span className="eyebrow">Potential rate</span>
            <div className="mono mt-1 text-[11px] font-semibold text-[#c9d8d3]">
              {formatMoneyCents(notice.penalty_rate_cents_dth)}/Dth
            </div>
          </div>
          <div className="min-w-32">
            <span className="eyebrow">{posted ? "Effective" : "Gate"}</span>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[#c9d8d3]">
              {posted ? <Clock3 size={11} /> : <LockKeyhole size={11} />}
              {posted ? formatCentralDateTime(notice.effective_start) : "Not yet in effect"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
