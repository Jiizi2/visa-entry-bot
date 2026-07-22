import React from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { 
  memberDisplayName, 
  resolvedProfileOf, 
  passportExtractedOf,
  rawValueFrom,
  childInfoForMember
} from '../utils/members';
import {
  normalizeInputValueForField,
  arabicFieldForLatinName,
  transliteratedArabicValueForField,
  REVIEW_FIELDS
} from '../utils/fields';
import ReviewImageViewer from './review/ReviewImageViewer';
import ReviewDropdown from './review/ReviewDropdown';
import ReviewDynamicForm from './review/ReviewDynamicForm';
import AppIcon from '../components/ui/AppIcon';

export default function ReviewPage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
  
  const members = state.manifest?.members || [];
  const activeMember = members.find((m: any) => m.id === state.activeMemberId) || members[0];
  const activeIndex = members.findIndex((m: any) => m.id === activeMember?.id);
  
  const saveManifestDisk = async (manifestData: any) => {
    if (!state.manifestPath || !manifestData) return;
    try {
      await invoke('save_manifest', { 
        manifestPath: state.manifestPath, 
        manifestData: JSON.parse(JSON.stringify(manifestData)) 
      });
    } catch (e) {
      console.error("Failed to save manifest to disk:", e);
    }
  };

  const handleNext = () => {
    let nextManifest = state.manifest;
    let nextSet = state.reviewedMemberIds;

    if (activeMember) {
      if (!state.reviewedMemberIds.has(activeMember.id)) {
        nextSet = new Set(state.reviewedMemberIds);
        nextSet.add(activeMember.id);
      }

      const newMembers = [...members];
      const index = newMembers.findIndex((m: any) => m.id === activeMember.id);
      if (index >= 0) {
        const updatedMember = JSON.parse(JSON.stringify(newMembers[index]));
        updatedMember.reviewConfirmed = true;
        updatedMember.reviewStatus = 'VALID';
        newMembers[index] = updatedMember;
        nextManifest = { ...state.manifest, members: newMembers };
      }
      
      updateState({ reviewedMemberIds: nextSet, manifest: nextManifest });
      saveManifestDisk(nextManifest);
    }

    if (activeIndex >= 0 && activeIndex < members.length - 1) {
      const nextId = members[activeIndex + 1].id;
      updateState({ activeMemberId: nextId });
    } else if (activeIndex === members.length - 1) {
      updateState({ currentPage: 'entry' });
    }
  };

  const handleMemberSelect = (id: string) => {
    updateState({ activeMemberId: id });
  };

  const handleFieldChange = (key: string, value: string) => {
    if (!activeMember) return;
    
    const normalized = normalizeInputValueForField(key, value);
    
    // Auto-update arabic if latin name is changed
    const arabicKey = arabicFieldForLatinName(key);
    let nextArabicVal: string | undefined = undefined;
    if (arabicKey) {
       nextArabicVal = transliteratedArabicValueForField(key, normalized);
    }

    const newMembers = [...members];
    const index = newMembers.findIndex(m => m.id === activeMember.id);
    if (index >= 0) {
      const updatedMember = JSON.parse(JSON.stringify(newMembers[index]));
      
      const parts = key.split('.');
      if (parts.length === 2) {
        if (!updatedMember.resolvedProfile[parts[0]]) updatedMember.resolvedProfile[parts[0]] = {};
        updatedMember.resolvedProfile[parts[0]][parts[1]] = normalized;
      } else {
        updatedMember.resolvedProfile[key] = normalized;
      }

      if (arabicKey && nextArabicVal) {
        const arabicParts = arabicKey.split('.');
        if (!updatedMember.resolvedProfile[arabicParts[0]]) updatedMember.resolvedProfile[arabicParts[0]] = {};
        updatedMember.resolvedProfile[arabicParts[0]][arabicParts[1]] = nextArabicVal;
      }

      updatedMember.reviewStatus = 'NEEDS_REVIEW'; // mark modified
      newMembers[index] = updatedMember;
      
      const nextManifest = { ...state.manifest, members: newMembers };
      updateState({ manifest: nextManifest });
      saveManifestDisk(nextManifest);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  const handleDeleteClick = () => {
    if (!activeMember) return;
    
    // Check if this member is acting as a companion to someone else
    const dependentChildren = members.filter((m: any) => 
      String(m.resolvedProfile?.companionId || m.companionMemberId || "").trim() === String(activeMember.id)
    );

    if (dependentChildren.length > 0) {
      const names = dependentChildren.map((m: any) => memberDisplayName(m)).join(', ');
      alert(`Passport ini tidak bisa dihapus karena masih terhubung sebagai companion (pendamping) untuk jamaah anak-anak:\n\n${names}\n\nSilakan hapus atau ubah companion pada jamaah anak tersebut terlebih dahulu.`);
      return;
    }

    setShowDeleteConfirm(true);
  };

  const executeDelete = () => {
    const newMembers = members.filter((m: any) => m.id !== activeMember.id);
    
    let nextActiveId = '';
    if (newMembers.length > 0) {
      if (activeIndex < newMembers.length) {
         nextActiveId = newMembers[activeIndex].id;
      } else {
         nextActiveId = newMembers[newMembers.length - 1].id;
      }
    }

    const nextManifest = { ...state.manifest, members: newMembers };
    updateState({ 
      manifest: nextManifest,
      activeMemberId: nextActiveId
    });
    saveManifestDisk(nextManifest);
    
    if (newMembers.length === 0) {
      updateState({ currentPage: 'entry' });
    }
    setShowDeleteConfirm(false);
  };

  if (!activeMember) {
    return <div className="page-empty-state">Belum ada data passport untuk direview.</div>;
  }

  const resolved = resolvedProfileOf(activeMember);
  const extracted = passportExtractedOf(activeMember);
  const remaining = members.length - (activeIndex >= 0 ? activeIndex + 1 : 0);

  const { isChild } = childInfoForMember(activeMember);
  const baseRequiredKeys = REVIEW_FIELDS.filter(f => f[2]?.required !== false).map(f => f[0]);
  const allRequiredKeys = isChild ? [...baseRequiredKeys, 'companionId', 'companionRelation'] : baseRequiredKeys;
  const filledCount = allRequiredKeys.filter(k => rawValueFrom(resolved, k)).length;
  const progressText = `${filledCount}/${allRequiredKeys.length} Wajib`;

  const isReviewed = Boolean(activeMember?.reviewConfirmed || state.reviewedMemberIds.has(activeMember?.id));

  return (
    <div className="page-container review-page">
      {/* Top Workspace Header */}
      <header className="app-page-header">
        <div className="app-page-header-left">
          <div className="app-page-header-icon">
            <AppIcon name="review" size={20} />
          </div>
          <div className="app-page-header-info">
            <span className="app-page-step-label">Langkah 4 · Validasi data</span>
            <h1 className="app-page-title">Review data</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="px-3 py-1 rounded-full type-caption bg-slate-200 text-slate-600 border border-slate-300/50">
            {remaining} dokumen tersisa
          </span>
        </div>
      </header>

      <section className="review-workspace">
        <ReviewDropdown
          members={members}
          activeMember={activeMember}
          resolved={resolved}
          onMemberSelect={handleMemberSelect}
          reviewedMemberIds={state.reviewedMemberIds}
        />

        <ReviewImageViewer
          activeMember={activeMember}
          manifestPath={state.manifestPath}
        />

        {/* Primary Column: review form */}
        <div className="review-inspector workstation-pane">
          
          {/* Form Header */}
          <div className="pb-4 border-b border-slate-300/50 shrink-0">
            <div className="flex items-start justify-between mb-2">
              <h2 className="type-subtitle text-slate-900 m-0 pr-4">{memberDisplayName(activeMember)}</h2>
            </div>
            <div className="flex items-center gap-3">
              {isReviewed ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md type-caption bg-green-50 text-green-700 border border-green-200">
                  <div className="w-2 h-2 rounded-full shrink-0 bg-green-500"></div> Sudah direview
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md type-caption bg-amber-50 text-amber-700 border border-amber-200">
                  <div className="w-2 h-2 rounded-full shrink-0 bg-amber-400"></div> Perlu review
                </span>
              )}
              <span className="font-mono type-body text-slate-600 bg-slate-200 px-2 py-0.5 rounded">
                {resolved?.passportNumber || '-'}
              </span>
            </div>
          </div>

          <ReviewDynamicForm 
            activeMember={activeMember}
            members={members}
            resolved={resolved}
            extracted={extracted}
            onChange={handleFieldChange}
          />

          {/* Footer / Action Area */}
          <div className="review-inspector__footer">
            <div className="flex items-center justify-between mb-3 type-body">
              <span className="text-slate-600">Progress Pengisian:</span>
              <span className={`type-caption-strong ${filledCount === allRequiredKeys.length ? 'text-emerald-700' : 'text-blue-700'}`}>
                {progressText}
              </span>
            </div>
            <div className="review-inspector__actions">
              <button 
                className="secondary-button review-delete-action"
                onClick={handleDeleteClick}
                title="Hapus passport dari manifest"
              >
                <AppIcon name="delete" />
                Hapus
              </button>
              <button
                className="primary-action ml-auto"
                onClick={handleNext}
                disabled={filledCount < allRequiredKeys.length}
              >
                {activeIndex === members.length - 1 ? 'Setujui & selesaikan' : 'Setujui & berikutnya'}
                <AppIcon name={activeIndex === members.length - 1 ? 'done_all' : 'arrow_forward'} />
              </button>
            </div>
          </div>
          
        </div>
      </section>

      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="review-delete-title">
            <div className="modal-header">
              <AppIcon name="warning" className="text-red-600" />
              <h3 id="review-delete-title">Konfirmasi hapus</h3>
            </div>
            <div className="modal-body">
              <p>
                Yakin ingin menghapus data passport <strong>{memberDisplayName(activeMember)}</strong>?
                Data yang dihapus tidak akan di-export ke JSON.
              </p>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="secondary-button"
              >
                Batal
              </button>
              <button 
                onClick={executeDelete}
                className="primary-action !bg-red-600 hover:!bg-red-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
