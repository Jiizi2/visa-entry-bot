import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { memberDisplayName, memberPassport } from '../../utils/members';
import AppIcon from '../../components/ui/AppIcon';

interface ReviewDropdownProps {
  members: any[];
  activeMember: any;
  resolved: any;
  onMemberSelect: (id: string) => void;
  reviewedMemberIds?: Set<string>;
}

export default function ReviewDropdown({ members, activeMember, resolved, onMemberSelect, reviewedMemberIds }: ReviewDropdownProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const compactRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const closeDropdown = (returnFocus = false) => {
    setDropdownOpen(false);
    setSearchQuery('');
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openDropdown = () => {
    setDropdownOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (compactRef.current && !compactRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && compactRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        closeDropdown(true);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleMemberSelect = (id: string) => {
    onMemberSelect(id);
    closeDropdown(true);
  };

  const isReviewed = (member: any) => Boolean(
    member?.reviewConfirmed || (reviewedMemberIds && reviewedMemberIds.has(member?.id)),
  );

  const activeReviewed = isReviewed(activeMember);
  const reviewedCount = members.filter(isReviewed).length;
  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('id-ID');
    if (!query) return members;
    return members.filter((member: any) => (
      memberDisplayName(member).toLocaleLowerCase('id-ID').includes(query)
      || memberPassport(member).toLocaleLowerCase('id-ID').includes(query)
    ));
  }, [members, searchQuery]);

  const focusOption = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(filteredMembers.length - 1, index));
    optionRefs.current[boundedIndex]?.focus();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      if (!dropdownOpen) {
        event.preventDefault();
        openDropdown();
      }
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && filteredMembers.length) {
      event.preventDefault();
      focusOption(0);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) searchInputRef.current?.focus();
      else focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(filteredMembers.length - 1);
    }
  };

  return (
    <div className="review-member-navigator">
      <aside className="review-member-queue workstation-pane" aria-label="Antrean passport">
        <header className="review-member-queue__header">
          <div>
            <strong>Antrean review</strong>
            <span>{reviewedCount}/{members.length} selesai</span>
          </div>
          <AppIcon name="checklist" size={17} />
        </header>
        <div className="review-member-queue__list" role="listbox" aria-label="Daftar passport">
          {members.map((member: any, index: number) => {
            const active = activeMember.id === member.id;
            const reviewed = isReviewed(member);
            return (
              <button
                key={member.id}
                className={`review-member-row ${active ? 'is-active' : ''}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => handleMemberSelect(member.id)}
              >
                <span className="review-member-row__index">{index + 1}</span>
                <span className="review-member-row__copy">
                  <strong>{memberDisplayName(member)}</strong>
                  <small>{member.resolvedProfile?.passportNumber || '-'}</small>
                </span>
                <span className={`review-member-row__status ${reviewed ? 'is-reviewed' : ''}`}>
                  <AppIcon name={reviewed ? 'check' : 'review'} size={13} />
                  <span className="sr-only">{reviewed ? 'Sudah direview' : 'Perlu review'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="review-member-compact" ref={compactRef}>
        <button
          ref={triggerRef}
          className={`review-member-select__trigger ${dropdownOpen ? 'is-open' : ''}`}
          type="button"
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          onClick={() => (dropdownOpen ? closeDropdown() : openDropdown())}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="review-member-select__leading" aria-hidden="true">
            <AppIcon name="user" size={18} />
          </span>
          <span className="review-member-select__selection">
            <small>Passport yang sedang direview</small>
            <strong>{memberDisplayName(activeMember)}</strong>
            <span>
              <code>{resolved?.passportNumber || '-'}</code>
              <span className={`review-member-select__status ${activeReviewed ? 'is-reviewed' : ''}`}>
                <AppIcon name={activeReviewed ? 'check' : 'review'} size={12} />
                {activeReviewed ? 'Sudah direview' : 'Perlu review'}
              </span>
            </span>
          </span>
          <span className="review-member-select__progress">
            <small>Progress</small>
            <strong>{reviewedCount}/{members.length}</strong>
          </span>
          <span className="review-member-select__chevron" aria-hidden="true">
            <AppIcon name="chevron_down" size={18} />
          </span>
        </button>

        {dropdownOpen && (
          <div className="review-member-select__menu">
            <header className="review-member-select__menu-header">
              <span className="review-member-select__menu-icon"><AppIcon name="review" size={18} /></span>
              <span><strong>Pilih passport</strong><small>Pindah ke data lain tanpa meninggalkan halaman Review.</small></span>
              <span>{reviewedCount} selesai</span>
            </header>

            <div className="review-member-select__search">
              <AppIcon name="search" size={17} />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Cari nama atau nomor passport…"
                aria-label="Cari passport"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} aria-label="Hapus pencarian">
                  <AppIcon name="close" size={15} />
                </button>
              )}
            </div>

            <div id={listboxId} className="review-member-select__list" role="listbox" aria-label="Pilih passport">
              {filteredMembers.length === 0 ? (
                <div className="review-member-select__empty" role="status">
                  <AppIcon name="search" size={20} />
                  <span><strong>Passport tidak ditemukan</strong><small>Coba gunakan nama atau nomor yang berbeda.</small></span>
                </div>
              ) : filteredMembers.map((member: any, index: number) => {
                const active = activeMember.id === member.id;
                const reviewed = isReviewed(member);
                const originalIndex = members.findIndex((item: any) => item.id === member.id);
                return (
                  <button
                    key={member.id}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`review-member-select__option ${active ? 'is-active' : ''}`}
                    onClick={() => handleMemberSelect(member.id)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  >
                    <span className="review-member-select__option-index">{originalIndex + 1}</span>
                    <span className="review-member-select__option-copy">
                      <strong>{memberDisplayName(member)}</strong>
                      <small>{memberPassport(member) || '-'}</small>
                    </span>
                    <span className={`review-member-select__option-status ${reviewed ? 'is-reviewed' : ''}`}>
                      <AppIcon name={reviewed ? 'check' : 'review'} size={13} />
                      {reviewed ? 'Selesai' : 'Perlu review'}
                    </span>
                    <span className="review-member-select__option-active" aria-hidden="true">
                      {active && <AppIcon name="check" size={15} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
