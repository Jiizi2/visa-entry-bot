import React from 'react';
import CustomDatePicker from '../../components/CustomDatePicker';
import { 
  memberDisplayName,
  rawValueFrom,
  confidenceLevelForMember,
  COMPANION_RELATION_OPTIONS,
  childInfoForMember
} from '../../utils/members';
import {
  FIELD_CATEGORY_DEFS,
  REVIEW_FIELDS,
  isReviewFieldRequired,
  maxLengthForField,
  isDateFieldKey
} from '../../utils/fields';

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
  
  const isMissing = required && !finalValue;
  const isLowConf = hasScan && confLevel === 'LOW';
  
  let alertClass = '';
  if (isMissing) {
    alertClass = 'input-error';
  } else if (isLowConf) {
    alertClass = 'input-warning';
  }
  
  const warningText = changed ? `Scan Asli: "${ocrValue}"` : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-1.5">
        <label className={`text-[12px] font-medium flex items-center gap-2 ${isMissing ? 'text-red-600' : 'text-slate-900'}`}>
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotTone === 'valid' ? 'bg-green-500' : dotTone === 'warn' ? 'bg-amber-400' : dotTone === 'error' ? 'bg-red-500' : 'bg-slate-500'}`} title={`Confidence: ${confLevel}`}></div>
          {label}
        </label>
        {required && (
          <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${isMissing ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
            Wajib
          </span>
        )}
      </div>
      {isDate ? (
          <CustomDatePicker 
            className={`w-full ${alertClass}`}
            value={(finalValue || '').replace(/\//g, '-')}
            onChange={(val) => onChange(keyName, val)}
            placeholder="YYYY-MM-DD"
          />
        ) : (
          <input 
            className={`w-full ${alertClass}`}
            type="text" 
            value={finalValue || ''}
            maxLength={maxLen || undefined}
            onChange={(e) => onChange(keyName, e.target.value)}
            placeholder={label}
          />
        )}
      {isMissing && (
        <p className="text-[11px] text-red-600 mt-1.5 ml-1 font-semibold flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span> Field ini wajib diisi
        </p>
      )}
      {warningText && !isMissing && (
        <p className="text-[11px] text-slate-600 mt-1 ml-4">
          {warningText}
        </p>
      )}
    </div>
  );
}

interface ReviewDynamicFormProps {
  activeMember: any;
  members: any[];
  resolved: any;
  extracted: any;
  onChange: (key: string, value: string) => void;
}

export default function ReviewDynamicForm({ activeMember, members, resolved, extracted, onChange }: ReviewDynamicFormProps) {
  const { isChild } = childInfoForMember(activeMember);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-6 mt-4 pr-2">
      {FIELD_CATEGORY_DEFS.map((category) => {
        const visibleFields = REVIEW_FIELDS.filter(([key]) => category.keys.includes(key));
        if (!visibleFields.length) return null;
        
        let icon = 'description';
        if (category.id === 'identity') icon = 'person';
        if (category.id === 'passport') icon = 'public';
        if (category.id === 'arabic') icon = 'translate';
        if (category.id === 'contact') icon = 'contact_mail';

        return (
          <div key={category.id} className="mb-6">
            <h3 className="text-[14px] leading-[20px] font-semibold tracking-wider text-slate-600 flex items-center gap-2 border-b border-slate-300/30 pb-2 m-0 mb-4">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{icon}</span> {category.label}
            </h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {visibleFields.map(([key, label]) => (
                <DynamicFormField 
                  key={key}
                  keyName={key}
                  label={label}
                  activeMember={activeMember}
                  resolved={resolved}
                  extracted={extracted}
                  onChange={onChange}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Bagian Companion / Pendamping */}
      {isChild && (
        <div className="mb-6">
          <h3 className="text-[14px] leading-[20px] font-semibold tracking-wider text-slate-600 flex items-center gap-2 border-b border-slate-300/30 pb-2 m-0 mb-4">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>group</span> Pendamping (Companion)
          </h3>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-[12px] font-medium flex items-center gap-2 ${!resolved?.companionId ? 'text-red-600' : 'text-slate-900'}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${!resolved?.companionId ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                  Anggota Pendamping
                </label>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${!resolved?.companionId ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
                  Wajib
                </span>
              </div>
              <select 
                className={`w-full appearance-none bg-[url('data:image/svg+xml,%3csvg_xmlns=\\'http://www.w3.org/2000/svg\\'_fill=\\'none\\'_viewBox=\\'0_0_20_20\\'%3e%3cpath_stroke=\\'%236b7280\\'_stroke-linecap=\\'round\\'_stroke-linejoin=\\'round\\'_stroke-width=\\'1.5\\'_d=\\'M6_8l4_4_4-4\\'/%3e%3c/svg%3e')] bg-no-repeat bg-[position:right_0.5rem_center] bg-[size:1.5em_1.5em] pr-10 ${!resolved?.companionId ? 'input-error' : ''}`}
                value={resolved?.companionId || ''}
                onChange={(e) => onChange('companionId', e.target.value)}
              >
                <option value="">Tidak ada / Mandiri</option>
                {members
                  .filter((m: any) => m.id !== activeMember.id)
                  .map((m: any) => (
                  <option key={m.id} value={m.id}>{memberDisplayName(m)}</option>
                ))}
              </select>
              {!resolved?.companionId && (
                <p className="text-[11px] text-red-600 mt-1.5 ml-1 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">error</span> Field ini wajib diisi
                </p>
              )}
            </div>

            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-[12px] font-medium flex items-center gap-2 ${!resolved?.companionRelation ? 'text-red-600' : 'text-slate-900'}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${!resolved?.companionRelation ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                  Hubungan
                </label>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${!resolved?.companionRelation ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
                  Wajib
                </span>
              </div>
              <select 
                className={`w-full appearance-none bg-[url('data:image/svg+xml,%3csvg_xmlns=\\'http://www.w3.org/2000/svg\\'_fill=\\'none\\'_viewBox=\\'0_0_20_20\\'%3e%3cpath_stroke=\\'%236b7280\\'_stroke-linecap=\\'round\\'_stroke-linejoin=\\'round\\'_stroke-width=\\'1.5\\'_d=\\'M6_8l4_4_4-4\\'/%3e%3c/svg%3e')] bg-no-repeat bg-[position:right_0.5rem_center] bg-[size:1.5em_1.5em] pr-10 ${!resolved?.companionRelation ? 'input-error' : ''}`}
                value={resolved?.companionRelation || ''}
                onChange={(e) => onChange('companionRelation', e.target.value)}
                disabled={!resolved?.companionId}
              >
                <option value="">Pilih Hubungan</option>
                {COMPANION_RELATION_OPTIONS.map((opt: string) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {!resolved?.companionRelation && (
                <p className="text-[11px] text-red-600 mt-1.5 ml-1 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">error</span> Field ini wajib diisi
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
