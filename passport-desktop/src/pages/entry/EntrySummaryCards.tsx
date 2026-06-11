import React from 'react';

interface EntrySummaryCardsProps {
  exportPreview: any;
}

export default function EntrySummaryCards({ exportPreview }: EntrySummaryCardsProps) {
  if (!exportPreview) return null;
  
  return (
    <div className="grid grid-cols-4 gap-5 mb-8">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-2">
        <span className="text-[12px] font-bold text-slate-500 tracking-[0.05em]">TOTAL DOCUMENTS</span>
        <span className="text-[32px] font-bold text-slate-900">{exportPreview.members.length}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-2">
        <span className="text-[12px] font-bold text-slate-500 tracking-[0.05em]">REVIEWED</span>
        <span className="text-[32px] font-bold text-slate-900">{exportPreview.reviewedMembers.length}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-2">
        <span className="text-[12px] font-bold text-slate-500 tracking-[0.05em]">IN BATCH</span>
        <span className="text-[32px] font-bold text-slate-900">{exportPreview.readyMembers.length}</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-2">
        <span className="text-[12px] font-bold text-slate-500 tracking-[0.05em]">SKIPPED</span>
        <span className="text-[32px] font-bold text-slate-900">{exportPreview.failedMembers.length + exportPreview.skippedMembers.length}</span>
      </div>
    </div>
  );
}
