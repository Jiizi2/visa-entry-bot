import React, { useState, useRef, useEffect } from 'react';

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
    daysGrid.push(<div key={`empty-${i}`} className="date-picker-empty"></div>);
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
        className={`date-picker-day ${isSelected ? 'selected' : ''}`}
      >
        {d}
      </button>
    );
  }

  const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  return (
    <div className="date-picker-container" ref={containerRef}>
      <input 
        type="text"
        className={className}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
      />
      <span 
        className="material-symbols-outlined date-picker-icon"
        onClick={() => setIsOpen(!isOpen)}
      >
        calendar_month
      </span>

      {isOpen && (
        <div className="date-picker-popup">
          <div className="date-picker-header">
            <button onClick={(e) => { e.preventDefault(); prevNav(); }} className="date-picker-nav-btn">
              <span className="material-symbols-outlined" style={{fontSize:'16px'}}>chevron_left</span>
            </button>
            
            {viewMode === 'days' ? (
              <span 
                className="date-picker-month-year" 
                onClick={() => { 
                  setViewMode('years'); 
                  setYearPageStart(currentYear - (currentYear % 12)); 
                }}
                style={{cursor: 'pointer'}}
                title="Pilih Tahun"
              >
                {monthNames[currentMonthIdx]} {currentYear}
              </span>
            ) : (
              <span className="date-picker-month-year">
                {yearPageStart} - {yearPageStart + 11}
              </span>
            )}

            <button onClick={(e) => { e.preventDefault(); nextNav(); }} className="date-picker-nav-btn">
              <span className="material-symbols-outlined" style={{fontSize:'16px'}}>chevron_right</span>
            </button>
          </div>
          
          {viewMode === 'days' ? (
            <>
              <div className="date-picker-weekdays">
                <span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span>
              </div>
              <div className="date-picker-grid">
                {daysGrid}
              </div>
            </>
          ) : (
            <div className="date-picker-years-grid">
              {Array.from({length: 12}, (_, i) => yearPageStart + i).map(y => (
                <button 
                  key={y}
                  className={`date-picker-year-btn ${y === currentYear ? 'selected' : ''}`}
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
