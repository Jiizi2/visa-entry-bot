import React from 'react';
import { useAppContext } from '../AppContext';
import {
  memberDisplayName,
  memberPassport,
  memberReviewStatus,
  childInfoForMember,
} from '../utils/members';

export default function MemberList() {
  const { state, updateState } = useAppContext();
  const members = state.manifest?.members || [];

  const handleFilter = (filter: string) => {
    updateState({ validationFilter: filter, passportListPage: 1 });
  };

  const visibleMembers = members.filter((m: any) => {
    if (state.validationFilter === 'all') return true;
    const status = memberReviewStatus(m);
    if (state.validationFilter === 'error') return status === 'ERROR' || status === 'NEEDS_REVIEW';
    if (state.validationFilter === 'valid') return status === 'VALID';
    return true;
  });

  const getTone = (member: any) => {
    const status = memberReviewStatus(member);
    if (status === 'ERROR') return 'error';
    if (status === 'NEEDS_REVIEW') return 'warn';
    if (Number(member.confidence ?? 0) < 0.9) return 'warn';
    return 'valid';
  };

  return (
    <aside className="review-sidebar-modern" aria-label="Daftar Data Passport">
      <div className="review-sidebar-header">
        <h3>Daftar Passport</h3>
        <div className="review-filter-row">
          <button
            className={`review-filter-btn ${state.validationFilter === 'all' ? 'active' : ''}`}
            onClick={() => handleFilter('all')}
          >
            Semua <span className="filter-count">{members.length}</span>
          </button>
          <button
            className={`review-filter-btn ${state.validationFilter === 'error' ? 'active' : ''}`}
            onClick={() => handleFilter('error')}
          >
            Error <span className="filter-count">{members.filter((m: any) => memberReviewStatus(m) === 'ERROR').length}</span>
          </button>
          <button
            className={`review-filter-btn ${state.validationFilter === 'valid' ? 'active' : ''}`}
            onClick={() => handleFilter('valid')}
          >
            Valid <span className="filter-count">{members.filter((m: any) => memberReviewStatus(m) === 'VALID').length}</span>
          </button>
        </div>
      </div>

      <div className="review-list-body">
        {visibleMembers.length === 0 ? (
          <div style={{ color: '#737686', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>Tidak ada data yang cocok.</div>
        ) : (
          visibleMembers.map((member: any) => {
            const isActive = member.id === state.activeMemberId;
            const reviewed = state.reviewedMemberIds.has(member.id);
            const tone = getTone(member);
            
            return (
              <div
                key={member.id}
                className={`review-member-item ${isActive ? 'active' : ''} ${reviewed ? 'reviewed' : ''}`}
                tabIndex={0}
                onClick={() => updateState({ activeMemberId: member.id, activeFieldCategory: 'identity' })}
              >
                <div className="member-item-main">
                  <div className="member-item-title">
                    <span className={`status-dot-modern ${tone}`}></span>
                    <span>{memberDisplayName(member)}</span>
                  </div>
                  <div className="member-item-meta">
                    {memberPassport(member) || 'NO_PASSPORT'}
                  </div>
                </div>
                {reviewed && (
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#22c55e' }}>check_circle</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
