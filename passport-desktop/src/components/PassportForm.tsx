import React from 'react';
import { useAppContext } from '../AppContext';
import {
  FIELD_CATEGORY_PAIRS,
  FIELD_CATEGORY_DEFS,
  REVIEW_FIELDS,
  isReviewFieldRequired,
  maxLengthForField,
  isDateFieldKey,
  normalizeInputValueForField,
  arabicFieldForLatinName,
  transliteratedArabicValueForField,
} from '../utils/fields';
import {
  memberDisplayName,
  memberPassport,
  memberReviewStatus,
  childInfoForMember,
  resolvedProfileOf,
  passportExtractedOf,
  valueFrom,
  rawValueFrom,
  fieldFlagsForMember,
  confidenceLevelForMember,
  confidenceValueForMember,
} from '../utils/members';

export default function PassportForm() {
  const { state, updateState } = useAppContext();
  const members = state.manifest?.members || [];
  const activeMember = members.find((m: any) => m.id === state.activeMemberId);

  if (!activeMember) {
    return (
      <section className="workspace-panel is-empty">
        <div className="workspace-head">
          <div className="workspace-copy">
            <h3 id="detail-title">Belum ada data dipilih</h3>
            <div id="detail-summary" className="detail-summary">
              Pilih salah satu data di panel kiri untuk mulai memeriksa dan memperbaiki hasil bacaan.
            </div>
          </div>
        </div>
      </section>
    );
  }

  const resolved = resolvedProfileOf(activeMember);
  const extracted = passportExtractedOf(activeMember);

  const getStatusTone = (member: any) => {
    const status = memberReviewStatus(member);
    if (status === 'ERROR') return 'error';
    if (status === 'NEEDS_REVIEW') return 'warn';
    if (Number(member.confidence ?? 0) < 0.85) return 'warn';
    return 'valid';
  };
  const getStatusLabel = (member: any) => {
    const status = memberReviewStatus(member);
    if (status === 'ERROR') return 'Perlu perhatian';
    if (status === 'NEEDS_REVIEW') return 'Perlu review';
    if (Number(member.confidence ?? 0) < 0.85) return 'Perlu dicek';
    return 'Reviewed';
  };

  const handleFieldChange = (key: string, value: string) => {
    const normalized = normalizeInputValueForField(key, value);
    
    // Auto-update arabic if latin name is changed and arabic is empty
    const arabicKey = arabicFieldForLatinName(key);
    let nextArabicVal = undefined;
    if (arabicKey) {
       const currentArabic = rawValueFrom(resolved, arabicKey);
       if (!currentArabic) {
         nextArabicVal = transliteratedArabicValueForField(key, normalized);
       }
    }

    // Call update action via custom event or context. Since members are mutable in original codebase, 
    // we should create a new members array to trigger re-render
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

  const activePair = FIELD_CATEGORY_PAIRS.find(p => p.id === state.activeFieldCategory) || FIELD_CATEGORY_PAIRS[0];

  const renderTabs = () => {
    const filledFinalKeys = new Set(REVIEW_FIELDS.filter(([key]) => rawValueFrom(resolved, key)).map(([key]) => key));

    return FIELD_CATEGORY_PAIRS.map(pair => {
      const categories = pair.categoryIds.map(id => FIELD_CATEGORY_DEFS.find(d => d.id === id)).filter(Boolean) as any[];
      const keys = categories.flatMap(c => c.keys);
      const requiredKeys = keys.filter((key: string) => isReviewFieldRequired(key));
      const total = requiredKeys.length;
      const filled = requiredKeys.filter((key: string) => filledFinalKeys.has(key)).length;
      const isActive = pair.id === state.activeFieldCategory;

      return (
        <button
          key={pair.id}
          className={`review-tab-btn ${isActive ? 'active' : ''}`}
          type="button"
          onClick={() => updateState({ activeFieldCategory: pair.id })}
        >
          <span>{pair.label}</span>
          <span className="req-badge">{filled}/{total} wajib</span>
        </button>
      );
    });
  };

  const renderFields = () => {
    const categories = activePair.categoryIds.map(id => FIELD_CATEGORY_DEFS.find(d => d.id === id)).filter(Boolean) as any[];
    const visibleFields = categories.flatMap(c => REVIEW_FIELDS.filter(([key]) => c.keys.includes(key)));

    if (!visibleFields.length) return <div style={{ color: '#737686', gridColumn: '1 / -1' }}>Kategori ini belum punya field.</div>;

    return visibleFields.map(([key, label, def]) => {
      const ocrValue = rawValueFrom(extracted, key);
      const finalValue = rawValueFrom(resolved, key);
      const isDate = isDateFieldKey(key);
      const required = isReviewFieldRequired(key);
      const maxLen = maxLengthForField(key);
      
      const confVal = confidenceValueForMember(activeMember, key);
      const confPercent = Math.round(Math.max(0, Math.min(Number(confVal ?? 0), 1)) * 100);
      const confLevel = confidenceLevelForMember(activeMember, key);
      
      const hasScan = Boolean(ocrValue);
      const changed = hasScan && ocrValue !== finalValue;
      const sourceBadge = hasScan ? (changed ? 'Diubah' : 'Asli') : 'Manual';
      
      let isAlert = false;
      if (required && !finalValue) isAlert = true;
      if (hasScan && confLevel === 'LOW') isAlert = true;

      return (
        <div key={key} className={`review-field-pair ${isAlert ? 'alert' : ''}`}>
          <div className="review-field-label">
            <span>{label}</span>
            <span className={`req-badge ${required ? 'required' : ''}`}>
              {required ? 'Wajib' : 'Optional'}
            </span>
          </div>
          <div className="review-field-input-wrap">
            <input
              value={finalValue || ''}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              maxLength={maxLen || undefined}
              placeholder={isDate ? "YYYY/MM/DD" : label}
              style={isAlert ? { borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)' } : {}}
            />
          </div>
          <div className="review-field-source">
            <span title={`Sumber scan: ${ocrValue || 'Belum terbaca'}`}>
              Sumber: <strong>{ocrValue || 'Tidak terbaca'}</strong> ({sourceBadge})
            </span>
            <span>Akurasi: {confPercent}%</span>
          </div>
        </div>
      );
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="review-main-header">
        <div className="review-main-header-left">
          <h2>{memberDisplayName(activeMember)}</h2>
          <div className="badge-row">
            <span className={`status-badge-modern ${getStatusTone(activeMember)}`}>
              <span className={`status-dot-modern ${getStatusTone(activeMember)}`}></span>
              {getStatusLabel(activeMember)}
            </span>
            <span className="status-badge-modern valid" style={{ background: '#f2f4f6', color: '#434655' }}>
              {valueFrom(resolved, "passportNumber") || 'NO PASSPORT'}
            </span>
          </div>
        </div>
      </div>

      <div className="review-form-body">
        <div className="review-tabs-modern">
          {renderTabs()}
        </div>
        
        <div className="review-fields-grid">
          {renderFields()}
        </div>
      </div>
    </div>
  );
}
