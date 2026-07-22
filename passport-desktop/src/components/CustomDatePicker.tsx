import React, { useState, useRef, useEffect } from 'react';
import AppIcon from './ui/AppIcon';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CustomDatePicker({ value, onChange, placeholder, className }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Parse value to initialize calendar view
  const parsedDate = value ? new Date(value) : new Date();
  const initialYear = !isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : new Date().getFullYear();
  const initialMonth = !isNaN(parsedDate.getTime()) ? parsedDate.getMonth() : new Date().getMonth();

  const [currentViewDate, setCurrentViewDate] = useState(new Date(initialYear, initialMonth, 1));
  const [inputValue, setInputValue] = useState(value || '');
  const [viewMode, setViewMode] = useState<'days' | 'years'>('days');
  const [yearPageStart, setYearPageStart] = useState<number>(initialYear - (initialYear % 12));

  useEffect(() => {
    setInputValue(value || '');
    if (value && !isNaN(new Date(value).getTime())) {
      const d = new Date(value);
      setCurrentViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentYear = currentViewDate.getFullYear();
  const currentMonthIdx = currentViewDate.getMonth();
  
  const daysInMonth = new Date(currentYear, currentMonthIdx + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonthIdx, 1).getDay(); // 0 = Sunday

  const prevNav = () => {
    if (viewMode === 'years') {
      setYearPageStart(y => y - 12);
    } else {
      setCurrentViewDate(new Date(currentYear, currentMonthIdx - 1, 1));
    }
  };

  const nextNav = () => {
    if (viewMode === 'years') {
      setYearPageStart(y => y + 12);
    } else {
      setCurrentViewDate(new Date(currentYear, currentMonthIdx + 1, 1));
    }
  };

  const handleDayClick = (day: number) => {
    const yyyy = currentYear;
    const mm = String(currentMonthIdx + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const newVal = `${yyyy}-${mm}-${dd}`;
    setInputValue(newVal);
    onChange(newVal);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
  };

  const daysGrid = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    daysGrid.push(<div key={`empty-${i}`} className="h-8"></div>);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const isSelected = value && !isNaN(parsedDate.getTime()) && 
      currentYear === parsedDate.getFullYear() && 
      currentMonthIdx === parsedDate.getMonth() && 
      d === parsedDate.getDate();
      
    daysGrid.push(
      <button 
        key={d} 
        onClick={(e) => { e.preventDefault(); handleDayClick(d); }}
        className={`flex items-center justify-center h-8 border-none rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-[var(--primary)] text-white type-body-strong' : 'bg-transparent text-slate-900 hover:bg-slate-200 type-body'}`}
      >
        {d}
      </button>
    );
  }

  const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  return (
    <div className="relative w-full" ref={containerRef}>
      <input 
        type="text"
        className={className}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center border-0 bg-transparent text-[var(--primary)] cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Buka kalender"
        aria-expanded={isOpen}
      >
        <AppIcon name="calendar" size={18} />
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-[280px] bg-white border border-slate-300 rounded-lg shadow-lg p-4 font-sans" role="dialog" aria-label="Pilih tanggal">
          <div className="flex items-center justify-between mb-3">
            <button onClick={(e) => { e.preventDefault(); prevNav(); }} className="flex items-center justify-center w-7 h-7 bg-transparent border border-slate-200 rounded-md cursor-pointer text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900">
              <AppIcon name="chevron_left" size={20} />
            </button>
            
            {viewMode === 'days' ? (
              <span 
                className="type-body-strong text-slate-900 flex items-center gap-1 transition-colors hover:text-[var(--primary)] cursor-pointer"
                onClick={() => { 
                  setViewMode('years'); 
                  setYearPageStart(currentYear - (currentYear % 12)); 
                }}
                title="Pilih Tahun"
              >
                {monthNames[currentMonthIdx]} {currentYear}
              </span>
            ) : (
              <span className="type-body-strong text-slate-900 flex items-center gap-1">
                {yearPageStart} - {yearPageStart + 11}
              </span>
            )}

            <button onClick={(e) => { e.preventDefault(); nextNav(); }} className="flex items-center justify-center w-7 h-7 bg-transparent border border-slate-200 rounded-md cursor-pointer text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900">
              <AppIcon name="chevron_right" size={20} />
            </button>
          </div>
          
          {viewMode === 'days' ? (
            <>
              <div className="grid grid-cols-7 gap-1 mb-2 text-center type-caption-strong text-slate-500">
                <span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {daysGrid}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {Array.from({length: 12}, (_, i) => yearPageStart + i).map(y => (
                <button 
                  key={y}
                  className={`h-10 border-none rounded-md cursor-pointer transition-colors ${y === currentYear ? 'bg-[var(--primary)] text-white type-body-strong' : 'bg-transparent text-slate-900 hover:bg-slate-200 type-body'}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setCurrentViewDate(new Date(y, currentMonthIdx, 1));
                    setViewMode('days');
                  }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
