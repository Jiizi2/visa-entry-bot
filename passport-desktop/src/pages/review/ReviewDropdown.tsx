import React, { useState } from 'react';
import { memberDisplayName } from '../../utils/members';

interface ReviewDropdownProps {
  members: any[];
  activeMember: any;
  resolved: any;
  onMemberSelect: (id: string) => void;
}

export default function ReviewDropdown({ members, activeMember, resolved, onMemberSelect }: ReviewDropdownProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleMemberSelect = (id: string) => {
    onMemberSelect(id);
    setDropdownOpen(false);
  };

  return (
    <div className="mb-4 relative z-20">
      <button 
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-3 px-4 py-2 border border-slate-300 rounded-lg bg-white w-full shadow-sm cursor-pointer transition-colors hover:bg-slate-100 text-left"
      >
        <div className="w-2 h-2 rounded-full shrink-0 bg-amber-400"></div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <span className="text-[14px] leading-[20px] font-semibold tracking-wider text-blue-700 whitespace-nowrap overflow-hidden text-ellipsis">
            {memberDisplayName(activeMember)}
          </span>
          <span className="text-[11px] leading-tight text-slate-600">
            {resolved?.passportNumber || '-'}
          </span>
        </div>
        <span className="material-symbols-outlined text-[24px] text-slate-600">expand_more</span>
      </button>
      
      {dropdownOpen && (
        <div className="absolute top-full mt-1 left-0 w-full bg-white border border-slate-300 rounded-lg shadow-lg py-1 flex flex-col z-30 max-h-64 overflow-y-auto">
          {members.map((m: any) => {
            const isActive = activeMember.id === m.id;
            return (
              <button 
                key={m.id}
                onClick={() => handleMemberSelect(m.id)}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 border-l-2 cursor-pointer hover:bg-slate-100 ${isActive ? 'border-blue-700 bg-blue-600/5' : 'border-transparent bg-transparent'}`}
              >
                <div className="w-2 h-2 rounded-full shrink-0 bg-slate-500"></div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <span className={`text-[14px] leading-[20px] font-semibold tracking-wider whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'text-slate-900' : 'text-slate-900'}`}>
                    {memberDisplayName(m)}
                  </span>
                  <span className="text-[11px] leading-tight text-slate-600">
                    {m.resolvedProfile?.passportNumber || '-'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
