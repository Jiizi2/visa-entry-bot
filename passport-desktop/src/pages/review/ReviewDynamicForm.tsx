import React from 'react';
import CustomDatePicker from '../../components/CustomDatePicker';
import AppIcon from '../../components/ui/AppIcon';
import CustomSelect from '../../components/ui/CustomSelect';
import { 
  memberDisplayName,
  memberPassport,
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
        <label className={`type-caption flex items-center gap-2 ${isMissing ? 'text-red-600' : 'text-slate-900'}`}>
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotTone === 'valid' ? 'bg-green-500' : dotTone === 'warn' ? 'bg-amber-400' : dotTone === 'error' ? 'bg-red-500' : 'bg-slate-500'}`} title={`Confidence: ${confLevel}`}></div>
          {label}
        </label>
        {required && (
          <span className={`type-caption-strong px-1.5 py-0.5 rounded ${isMissing ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
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
        <p className="type-caption-strong text-red-600 mt-1.5 ml-1 flex items-center gap-1">
          <AppIcon name="error" size={14} /> Field ini wajib diisi
        </p>
      )}
      {warningText && !isMissing && (
        <p className="type-caption text-slate-600 mt-1 ml-4">
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
  const companionOptions = [
    { value: '', label: 'Tidak ada / Mandiri', description: 'Tidak menggunakan anggota pendamping' },
    ...members
      .filter((member: any) => member.id !== activeMember.id)
      .map((member: any) => ({
        value: member.id,
        label: memberDisplayName(member),
        description: memberPassport(member) || 'Nomor passport belum tersedia',
      })),
  ];
  const relationOptions = [
    { value: '', label: 'Pilih hubungan' },
    ...COMPANION_RELATION_OPTIONS.map((relation: string) => ({ value: relation, label: relation })),
  ];

  return (
    <div className="review-form flex-1 overflow-y-auto flex flex-col gap-6 mt-4 pr-2">
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
            <h3 className="type-body-strong text-slate-600 flex items-center gap-2 border-b border-slate-300/30 pb-2 m-0 mb-4">
              <AppIcon name={icon} size={20} /> {category.label}
            </h3>
            <div className="review-fields-grid">
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
          <h3 className="type-body-strong text-slate-600 flex items-center gap-2 border-b border-slate-300/30 pb-2 m-0 mb-4">
            <AppIcon name="group" size={20} /> Pendamping (Companion)
          </h3>
          <div className="review-fields-grid">
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className={`type-caption flex items-center gap-2 ${!resolved?.companionId ? 'text-red-600' : 'text-slate-900'}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${!resolved?.companionId ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                  Anggota Pendamping
                </label>
                <span className={`type-caption-strong px-1.5 py-0.5 rounded ${!resolved?.companionId ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
                  Wajib
                </span>
              </div>
              <CustomSelect
                value={resolved?.companionId || ''}
                options={companionOptions}
                onChange={(value) => onChange('companionId', value)}
                placeholder="Pilih anggota pendamping"
                ariaLabel="Anggota Pendamping"
                icon="group"
                invalid={!resolved?.companionId}
                searchable
                searchPlaceholder="Cari nama atau nomor passport…"
                emptyMessage="Anggota tidak ditemukan"
              />
              {!resolved?.companionId && (
                <p className="type-caption-strong text-red-600 mt-1.5 ml-1 flex items-center gap-1">
                  <AppIcon name="error" size={14} /> Field ini wajib diisi
                </p>
              )}
            </div>

            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className={`type-caption flex items-center gap-2 ${!resolved?.companionRelation ? 'text-red-600' : 'text-slate-900'}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${!resolved?.companionRelation ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                  Hubungan
                </label>
                <span className={`type-caption-strong px-1.5 py-0.5 rounded ${!resolved?.companionRelation ? 'text-red-700 bg-red-600/10' : 'text-blue-700 bg-blue-600/10'}`}>
                  Wajib
                </span>
              </div>
              <CustomSelect
                value={resolved?.companionRelation || ''}
                options={relationOptions}
                onChange={(value) => onChange('companionRelation', value)}
                placeholder={resolved?.companionId ? 'Pilih hubungan' : 'Pilih pendamping terlebih dahulu'}
                ariaLabel="Hubungan dengan Pendamping"
                icon="checklist"
                invalid={!resolved?.companionRelation}
                disabled={!resolved?.companionId}
                searchable
                searchPlaceholder="Cari jenis hubungan…"
                emptyMessage="Hubungan tidak ditemukan"
              />
              {!resolved?.companionRelation && (
                <p className="type-caption-strong text-red-600 mt-1.5 ml-1 flex items-center gap-1">
                  <AppIcon name="error" size={14} /> Field ini wajib diisi
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
