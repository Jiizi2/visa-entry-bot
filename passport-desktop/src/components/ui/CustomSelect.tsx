import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import AppIcon from './AppIcon';

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  icon?: string;
  invalid?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

interface MenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  icon = 'checklist',
  invalid = false,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Cari pilihan…',
  emptyMessage = 'Pilihan tidak ditemukan',
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
    if (!normalizedQuery) return options;
    return options.filter((option) => (
      `${option.label} ${option.description || ''} ${option.keywords || ''}`
        .toLocaleLowerCase('id-ID')
        .includes(normalizedQuery)
    ));
  }, [options, query]);

  const calculateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const menuGap = 6;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - menuGap;
    const availableAbove = rect.top - viewportPadding - menuGap;
    const openUpward = availableBelow < 260 && availableAbove > availableBelow;
    const availableHeight = openUpward ? availableAbove : availableBelow;
    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );

    return {
      left,
      width,
      maxHeight: Math.max(148, availableHeight),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + menuGap }
        : { top: rect.bottom + menuGap }),
    };
  }, []);

  const updateMenuPosition = useCallback(() => {
    const nextPosition = calculateMenuPosition();
    if (nextPosition) setMenuPosition(nextPosition);
  }, [calculateMenuPosition]);

  const closeMenu = useCallback((returnFocus = false) => {
    setIsOpen(false);
    setQuery('');
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const focusOption = useCallback((index: number) => {
    const boundedIndex = Math.max(0, Math.min(filteredOptions.length - 1, index));
    optionRefs.current[boundedIndex]?.focus();
  }, [filteredOptions.length]);

  const focusInitialControl = useCallback(() => {
    requestAnimationFrame(() => {
      if (searchable) {
        searchRef.current?.focus();
        return;
      }
      const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
      focusOption(selectedIndex >= 0 ? selectedIndex : 0);
    });
  }, [filteredOptions, focusOption, searchable, value]);

  const openMenu = () => {
    if (disabled) return;
    setMenuPosition(calculateMenuPosition());
    setIsOpen(true);
    focusInitialControl();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [closeMenu, isOpen, updateMenuPosition]);

  useEffect(() => {
    if (disabled && isOpen) closeMenu();
  }, [closeMenu, disabled, isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) openMenu();
      else focusInitialControl();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && filteredOptions.length) {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      triggerRef.current?.focus();
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0 && searchable) searchRef.current?.focus();
      else focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(filteredOptions.length - 1);
    }
  };

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    closeMenu(true);
  };

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        top: menuPosition.top,
        bottom: menuPosition.bottom,
      }
    : undefined;

  return (
    <div className="form-custom-select" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`form-custom-select__trigger ${isOpen ? 'is-open' : ''} ${invalid ? 'is-invalid' : ''}`}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="form-custom-select__leading" aria-hidden="true">
          <AppIcon name={icon} size={16} />
        </span>
        <span className={`form-custom-select__value ${selectedOption ? '' : 'is-placeholder'}`}>
          <strong>{selectedOption?.label || placeholder}</strong>
          {selectedOption?.description && <small>{selectedOption.description}</small>}
        </span>
        <span className="form-custom-select__chevron" aria-hidden="true">
          <AppIcon name="chevron_down" size={17} />
        </span>
      </button>

      {isOpen && menuStyle && createPortal(
        <div ref={menuRef} className="form-custom-select__menu" style={menuStyle}>
          {searchable && (
            <div className="form-custom-select__search">
              <AppIcon name="search" size={16} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Hapus pencarian">
                  <AppIcon name="close" size={14} />
                </button>
              )}
            </div>
          )}

          <div id={listboxId} className="form-custom-select__options" role="listbox" aria-label={ariaLabel}>
            {filteredOptions.length === 0 ? (
              <div className="form-custom-select__empty" role="status">
                <AppIcon name="search" size={18} />
                <span>{emptyMessage}</span>
              </div>
            ) : filteredOptions.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value || '__empty'}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  className={`form-custom-select__option ${selected ? 'is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                >
                  <span className="form-custom-select__option-icon" aria-hidden="true">
                    <AppIcon name={selected ? 'check' : icon} size={15} />
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {selected && <AppIcon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
