import React from 'react';
import { memberDisplayName, memberPassport, memberReviewStatus, resolvedProfileOf } from '../../utils/members';

interface EntryTableProps {
  exportPreview: any;
  reviewedMemberIds: Set<string>;
}

export default function EntryTable({ exportPreview, reviewedMemberIds }: EntryTableProps) {
  if (!exportPreview) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-6 py-4 text-[12px] font-bold text-slate-500 tracking-[0.05em] border-b border-slate-200 bg-slate-50">APPLICANT DETAILS</th>
            <th className="text-left px-6 py-4 text-[12px] font-bold text-slate-500 tracking-[0.05em] border-b border-slate-200 bg-slate-50">EXTRACTED METADATA</th>
            <th className="text-left px-6 py-4 text-[12px] font-bold text-slate-500 tracking-[0.05em] border-b border-slate-200 bg-slate-50">STATUS</th>
          </tr>
        </thead>
        <tbody>
          {exportPreview.members.length === 0 ? (
            <tr><td colSpan={3} className="text-center p-10 text-slate-500 text-[14px]">Belum ada data untuk dipreview.</td></tr>
          ) : (
            exportPreview.members.map((member: any) => {
              const profile = resolvedProfileOf(member);
              const isReviewed = member.reviewConfirmed || reviewedMemberIds.has(member.id);
              const status = memberReviewStatus(member);

              return (
                <tr key={member.id}>
                  <td className="px-6 py-5 border-b border-slate-200 align-top last:border-b-0">
                    <div className="text-[14px] font-bold text-slate-900 mb-1.5">{memberDisplayName(member)}</div>
                    <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      {memberPassport(member) || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-5 border-b border-slate-200 align-top last:border-b-0">
                    <div className="grid grid-cols-[60px_1fr] gap-y-2 gap-x-3 text-[13px]">
                      <span className="text-slate-400">DOB</span><span className="text-slate-900 font-medium">{profile.dob || '-'}</span>
                      <span className="text-slate-400">Nat</span><span className="text-slate-900 font-medium">{profile.nationality || '-'}</span>
                      <span className="text-slate-400">Gender</span><span className="text-slate-900 font-medium">{profile.gender || '-'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 border-b border-slate-200 align-top last:border-b-0">
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold ${isReviewed ? 'bg-blue-50 text-blue-700 border border-blue-200' : status === 'ERROR' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                      {isReviewed && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                      {isReviewed ? 'Reviewed' : status === 'ERROR' ? 'Error' : 'Pending'}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
