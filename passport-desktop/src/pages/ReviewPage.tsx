import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import CustomDatePicker from '../components/CustomDatePicker';
import { useAppContext } from '../AppContext';
import { 
  memberDisplayName, 
  resolvedProfileOf, 
  passportExtractedOf,
  rawValueFrom,
  confidenceLevelForMember,
  COMPANION_RELATION_OPTIONS,
  childInfoForMember
} from '../utils/members';
import {
  FIELD_CATEGORY_DEFS,
  REVIEW_FIELDS,
  isReviewFieldRequired,
  maxLengthForField,
  isDateFieldKey,
  normalizeInputValueForField,
  arabicFieldForLatinName,
  transliteratedArabicValueForField,
} from '../utils/fields';
import './review-page.css';

function DynamicFormField({ keyName, label, activeMember, resolved, extracted, onChange }: any) {
  const ocrValue = rawValueFrom(extracted, keyName);
  const finalValue = rawValueFrom(resolved, keyName);
  const isDate = isDateFieldKey(keyName);
  const required = isReviewFieldRequired(keyName);
  const maxLen = maxLengthForField(keyName);
  
  const confLevel = confidenceLevelForMember(activeMember, keyName);
  let dotTone = 'neutral';
  if (confLevel === 'HIGH') dotTone = 'valid';
  else if (confLevel === 'MEDIUM') dotTone = 'warn';
  else if (confLevel === 'LOW') dotTone = 'error';

  const hasScan = Boolean(ocrValue);
  const changed = hasScan && ocrValue !== finalValue;
  
  let isAlert = false;
  if (required && !finalValue) isAlert = true;
  if (hasScan && confLevel === 'LOW') isAlert = true;
  
  const warningText = changed ? `Scan Asli: "${ocrValue}"` : null;

  return (
    <div className={`review-field-group`}>
      <div className="review-field-header">
        <label className="review-field-label">
          <div className={`review-dropdown-dot ${dotTone}`} title={`Confidence: ${confLevel}`}></div>
          {label}
        </label>
        {required && <span className="review-field-req">Wajib</span>}
      </div>
      {isDate ? (
        <CustomDatePicker 
          className={`review-field-input ${isAlert ? 'is-warn' : ''} is-code`}
          value={(finalValue || '').replace(/\//g, '-')}
          onChange={(val) => onChange(keyName, val)}
          placeholder="YYYY-MM-DD"
        />
      ) : (
        <input 
          className={`review-field-input ${isAlert ? 'is-warn' : ''}`}
          type="text" 
          value={finalValue || ''}
          maxLength={maxLen || undefined}
          onChange={(e) => onChange(keyName, e.target.value)}
          placeholder={label}
        />
      )}
      {warningText && (
        <p className="review-field-hint">
          {warningText}
        </p>
      )}
    </div>
  );
}

export default function ReviewPage() {
  const { state, updateState } = useAppContext();
  const [activeImageData, setActiveImageData] = useState<{dataUrl?: string}>({});
  const [zoom, setZoom] = useState(1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 });
  
  const members = state.manifest?.members || [];
  const activeMember = members.find((m: any) => m.id === state.activeMemberId) || members[0];
  const activeIndex = members.findIndex((m: any) => m.id === activeMember?.id);
  
  useEffect(() => {
    if (activeMember) {
      const loadImg = async () => {
        try {
          const res: any = await invoke('load_passport_image_data', {
            manifestPath: state.manifestPath || '',
            imagePath: activeMember.editedPath || activeMember.scanPath || activeMember.passportExtracted?.sourceImagePath || '',
            fileName: activeMember.fileName || '',
          });
          setActiveImageData(res || {});
          setZoom(1); // Reset zoom on new image
        } catch (e) {
          console.error(e);
          setActiveImageData({});
        }
      };
      loadImg();
    } else {
      setActiveImageData({});
    }
  }, [activeMember, state.manifestPath]);

  // Handle Ctrl+Scroll to zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(z => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          return Math.min(Math.max(0.5, z + delta), 5);
        });
      }
    };
    const el = imgContainerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (imgContainerRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setScrollStart({ 
        x: imgContainerRef.current.scrollLeft, 
        y: imgContainerRef.current.scrollTop 
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && imgContainerRef.current) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      imgContainerRef.current.scrollLeft = scrollStart.x - dx;
      imgContainerRef.current.scrollTop = scrollStart.y - dy;
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
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
    setDropdownOpen(false);
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
      updateState({ manifest: { ...state.manifest, members: newMembers } });
    }
  };

  if (!activeMember) {
    return <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>Belum ada data.</div>;
  }

  const resolved = resolvedProfileOf(activeMember);
  const extracted = passportExtractedOf(activeMember);
  const remaining = members.length - (activeIndex >= 0 ? activeIndex + 1 : 0);
  const { isChild } = childInfoForMember(activeMember);

  const allRequiredKeys = REVIEW_FIELDS.filter(f => f[2]?.required !== false).map(f => f[0]);
  const filledKeysCount = allRequiredKeys.filter(k => rawValueFrom(resolved, k)).length;
  const progressText = `${filledKeysCount}/${allRequiredKeys.length} Wajib`;

  return (
    <div className="review-page-modern">
      {/* Top Workspace Header */}
      <div style={{ padding: '16px 16px 0 16px', flexShrink: 0, zIndex: 20 }}>
        <header className="scan-header-modern" style={{ margin: 0, maxWidth: 'none', padding: '16px 24px' }}>
          <div className="scan-header-title-area">
            <div className="scan-header-icon" style={{ background: 'linear-gradient(135deg, #004ac6, #3b82f6)', boxShadow: '0 4px 12px rgba(0, 74, 198, 0.2)' }}>
              <span className="material-symbols-outlined">fact_check</span>
            </div>
            <div>
              <span className="step-eyebrow">LANGKAH 4: VALIDASI DATA</span>
              <h1 className="scan-title">Data Review</h1>
            </div>
          </div>
          <div className="scan-window-controls">
            <span className="scan-badge" style={{ background: '#e6e8ea', color: '#505f76', border: '1px solid rgba(195, 198, 215, 0.5)' }}>
              {remaining} Documents Remaining
            </span>
          </div>
        </header>
      </div>

      {/* Main Workspace: Two Columns (Form Dominant) */}
      <section className="review-workspace-modern">
        
        {/* Left Column: Dropdown and Image */}
        <div className="review-col-left">
          
          {/* Dropdown */}
          <div className="review-dropdown-container">
            <button 
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="review-dropdown-btn"
            >
              <div className="review-dropdown-dot warn"></div>
              <div className="review-dropdown-text">
                <span className="review-dropdown-name">
                  {memberDisplayName(activeMember)}
                </span>
                <span className="review-dropdown-meta">
                  {resolved?.passportNumber || '-'}
                </span>
              </div>
              <span className="material-symbols-outlined review-dropdown-icon">expand_more</span>
            </button>
            
            {dropdownOpen && (
              <div className="review-dropdown-menu">
                {members.map((m: any) => (
                  <button 
                    key={m.id}
                    onClick={() => handleMemberSelect(m.id)}
                    className={`review-dropdown-item ${activeMember.id === m.id ? 'is-active' : ''}`}
                  >
                    <div className="review-dropdown-dot neutral"></div>
                    <div className="review-dropdown-text">
                      <span className="review-dropdown-name">
                        {memberDisplayName(m)}
                      </span>
                      <span className="review-dropdown-meta">
                        {m.resolvedProfile?.passportNumber || '-'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Image Viewer */}
          <div className="review-image-viewer">
            <div className="review-image-bg"></div>
            <div className="review-image-card">
              <div className="review-image-header">
                <h3 className="review-image-title">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>description</span> Source Document
                </h3>
                <span className="review-image-badge">Passport Preview</span>
                <div className="review-zoom-controls" title="Gunakan Ctrl + Scroll untuk Zoom">
                  <button className="review-zoom-btn" title="Zoom Out" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>remove</span>
                  </button>
                  <div className="review-zoom-level">
                    {Math.round(zoom * 100)}%
                  </div>
                  <button className="review-zoom-btn" title="Zoom In" onClick={() => setZoom(z => Math.min(5, z + 0.25))}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                  </button>
                </div>
              </div>
              <div 
                className="review-image-canvas"
                ref={imgContainerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ 
                  cursor: isDragging ? 'grabbing' : 'grab',
                  display: 'block',
                  position: 'relative'
                }}
              >
                <div style={{
                  width: `${zoom * 100}%`,
                  minWidth: '100%',
                  minHeight: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: isDragging ? 'none' : 'width 0.2s ease-out'
                }}>
                  {activeImageData.dataUrl ? (
                     <img 
                       alt="Scanned passport document view" 
                       src={activeImageData.dataUrl}
                       draggable={false}
                       style={{ 
                         width: '100%', 
                         height: 'auto', 
                         maxHeight: zoom <= 1 ? '75vh' : 'none',
                         objectFit: 'contain',
                         mixBlendMode: 'multiply',
                         pointerEvents: 'none'
                       }} 
                     />
                  ) : (
                     <div style={{ padding: '40px', color: '#737686', fontSize: '14px' }}>Tidak ada gambar</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Streamlined Data Form */}
        <div className="review-col-right">
          
          {/* Form Header */}
          <div className="review-form-header">
            <div className="review-form-title">
              <h2>{memberDisplayName(activeMember)}</h2>
            </div>
            <div className="review-form-badges">
              <span className="review-status-badge warn">
                <div className="review-dropdown-dot warn"></div> Needs Review
              </span>
              <span className="review-passport-badge">
                {resolved?.passportNumber || '-'}
              </span>
            </div>
          </div>

          {/* Form Content */}
          <div className="review-form-content">
            
            {FIELD_CATEGORY_DEFS.map((category) => {
              const visibleFields = REVIEW_FIELDS.filter(([key]) => category.keys.includes(key));
              if (!visibleFields.length) return null;
              
              let icon = 'description';
              if (category.id === 'identity') icon = 'person';
              if (category.id === 'passport') icon = 'public';
              if (category.id === 'arabic') icon = 'translate';
              if (category.id === 'contact') icon = 'contact_mail';

              return (
                <div key={category.id} style={{ marginBottom: '24px' }}>
                  <h3 className="review-section-title">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{icon}</span> {category.label}
                  </h3>
                  <div className="review-field-grid">
                    {visibleFields.map(([key, label]) => (
                      <DynamicFormField 
                        key={key}
                        keyName={key}
                        label={label}
                        activeMember={activeMember}
                        resolved={resolved}
                        extracted={extracted}
                        onChange={handleFieldChange}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Bagian Companion / Pendamping */}
            {isChild && (
              <div style={{ marginBottom: '24px' }}>
                <h3 className="review-section-title">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>group</span> Pendamping (Companion)
                </h3>
                <div className="review-field-grid">
                  <div className="review-field-group">
                    <div className="review-field-header">
                      <label className="review-field-label">
                        <div className="review-dropdown-dot neutral"></div>
                        Anggota Pendamping
                      </label>
                    </div>
                    <select 
                      className="review-field-input"
                      value={resolved?.companionId || ''}
                      onChange={(e) => handleFieldChange('companionId', e.target.value)}
                    >
                      <option value="">Tidak ada / Mandiri</option>
                      {members
                        .filter((m: any) => m.id !== activeMember.id)
                        .map((m: any) => (
                        <option key={m.id} value={m.id}>{memberDisplayName(m)}</option>
                      ))}
                    </select>
                  </div>

                  <div className="review-field-group">
                    <div className="review-field-header">
                      <label className="review-field-label">
                        <div className="review-dropdown-dot neutral"></div>
                        Hubungan
                      </label>
                    </div>
                    <select 
                      className="review-field-input"
                      value={resolved?.companionRelation || ''}
                      onChange={(e) => handleFieldChange('companionRelation', e.target.value)}
                      disabled={!resolved?.companionId}
                    >
                      <option value="">Pilih Hubungan</option>
                      {COMPANION_RELATION_OPTIONS.map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            
          </div>

          {/* Footer / Action Area */}
          <div className="review-form-footer">
            <div className="review-progress-row">
              <span className="review-progress-text">Progress Pengisian:</span>
              <span className="review-progress-warn" style={{ color: filledKeysCount === allRequiredKeys.length ? '#15803d' : '#d97706' }}>
                {progressText}
              </span>
            </div>
            <div className="review-action-row">
              <button 
                className="review-btn-primary"
                onClick={handleNext}
              >
                {activeIndex === members.length - 1 ? 'Approve & Finish Review' : 'Approve & Next Document'}
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {activeIndex === members.length - 1 ? 'done_all' : 'arrow_forward'}
                </span>
              </button>
              <button className="review-btn-secondary">
                Flag as Error
              </button>
            </div>
          </div>
          
        </div>
      </section>
    </div>
  );
}
