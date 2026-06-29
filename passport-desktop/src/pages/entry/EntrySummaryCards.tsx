import React from 'react';

interface EntrySummaryCardsProps {
  exportPreview: any;
}

export default function EntrySummaryCards({ exportPreview }: EntrySummaryCardsProps) {
  if (!exportPreview) return null;
  
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-white border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.02)] rounded-2xl p-6 flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 tracking-[0.08em] uppercase">Total Documents</span>
        <span className="text-[32px] font-extrabold text-slate-950 leading-none">{exportPreview.members.length}</span>
      </div>
      <div className="bg-white border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.02)] rounded-2xl p-6 flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 tracking-[0.08em] uppercase">Reviewed</span>
        <span className="text-[32px] font-extrabold text-slate-950 leading-none">{exportPreview.reviewedMembers.length}</span>
      </div>
      <div className="bg-white border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.02)] rounded-2xl p-6 flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 tracking-[0.08em] uppercase">In Batch</span>
        <span className="text-[32px] font-extrabold text-slate-950 leading-none">{exportPreview.readyMembers.length}</span>
      </div>
      <div className="bg-white border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.02)] rounded-2xl p-6 flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 tracking-[0.08em] uppercase">Skipped</span>
        <span className="text-[32px] font-extrabold text-slate-950 leading-none">{exportPreview.failedMembers.length + exportPreview.skippedMembers.length}</span>
      </div>
    </div>
  );
}
