import React from 'react';
import { memberDisplayName, memberPassport, memberReviewStatus, resolvedProfileOf } from '../../utils/members';
import AppIcon from '../../components/ui/AppIcon';

interface EntryTableProps {
  exportPreview: any;
  reviewedMemberIds: Set<string>;
}

export default function EntryTable({ exportPreview, reviewedMemberIds }: EntryTableProps) {
  if (!exportPreview) return null;

  const readyMemberIds = new Set(exportPreview.readyMembers.map((member: any) => String(member.id || '')));

  return (
    <div className="entry-table-wrap workstation-pane">
      <table className="entry-table">
        <caption className="sr-only">Daftar passport dalam batch export</caption>
        <thead>
          <tr>
            <th>Passport</th>
            <th>Data utama</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {exportPreview.members.length === 0 ? (
            <tr><td colSpan={3} className="text-center p-10 text-slate-500 type-body">Belum ada data dalam batch ini.</td></tr>
          ) : (
            exportPreview.members.map((member: any) => {
              const profile = resolvedProfileOf(member);
              const isReviewed = member.reviewConfirmed || reviewedMemberIds.has(member.id);
              const status = memberReviewStatus(member);
              const isReady = readyMemberIds.has(String(member.id || ''));
              const statusLabel = isReady
                ? 'Siap dikirim'
                : status === 'ERROR'
                  ? 'Perlu diperbaiki'
                  : isReviewed
                    ? 'Tidak disertakan'
                    : 'Belum direview';
              const statusTone = isReady ? 'ready' : status === 'ERROR' ? 'danger' : isReviewed ? 'neutral' : 'warn';

              return (
                <tr key={member.id}>
                  <td>
                    <div className="entry-member-name">{memberDisplayName(member)}</div>
                    <div className="entry-member-passport">
                      <AppIcon name="file" size={13} />
                      {memberPassport(member) || '-'}
                    </div>
                  </td>
                  <td>
                    <div className="entry-member-data">
                      <span>{profile.dob || '-'}</span>
                      <span>{profile.nationality || '-'}</span>
                      <span>{profile.gender === 'M' ? 'Laki-laki' : profile.gender === 'F' ? 'Perempuan' : profile.gender || '-'}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-chip ${statusTone}`}>
                      <AppIcon name={isReady ? 'check' : status === 'ERROR' ? 'alert' : isReviewed ? 'minus' : 'hourglass'} size={13} />
                      {statusLabel}
                    </span>
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
