import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import AppIcon from './ui/AppIcon';
import WindowPet from './WindowPet';
import { defaultPetPhoto, readPetPhoto } from '../utils/pet-photo';
import '../styles/components/SidebarPet.css';

const visibilityKey = 'entrymate.pet.visible';
function readVisibility() {
  try {
    return localStorage.getItem(visibilityKey) !== 'false';
  } catch {
    return true;
  }
}

export default memo(function SidebarPet() {
  const [isVisible, setIsVisible] = useState(readVisibility);
  const [photo] = useState(readPetPhoto);
  const [playRequest, setPlayRequest] = useState(0);
  const [playAnnouncement, setPlayAnnouncement] = useState('');
  const announceReaction = useCallback((line: string) => setPlayAnnouncement(line), []);
  const isBusy = useStore(state => state.isScanning || state.isStartingScan ||
    state.isStoppingScan || state.isPreparingImages || state.isEntryRunning);

  const toggleVisibility = () => {
    const next = !isVisible;
    setIsVisible(next);
    try {
      localStorage.setItem(visibilityKey, String(next));
    } catch {
      // The toggle still works when storage is unavailable.
    }
  };
  const toggleLabel = isVisible ? 'Sembunyikan pet' : 'Tampilkan pet';
  const displayedPhoto = photo || defaultPetPhoto;

  return (
    <section className='sidebar-pet' aria-label='Teman kecil EntryMate'>
      <button
        type='button'
        className='sidebar-pet__control sidebar-pet__play-control'
        onClick={() => setPlayRequest(request => request + 1)}
        disabled={isBusy || !isVisible}
        aria-label='Ajak main'
        title={isBusy ? 'Pet istirahat selama pemrosesan' : !isVisible ? 'Tampilkan pet untuk mengajak main' : 'Ajak pet melambai, joget, atau melompat'}
      >
        <AppIcon name='play' size={18} />
        <span className='sidebar-pet__label'>Ajak main</span>
      </button>
      <button
        type='button'
        className='sidebar-pet__control'
        onClick={toggleVisibility}
        aria-label={toggleLabel}
        aria-pressed={isVisible}
        title={toggleLabel}
      >
        <AppIcon name='pet' size={18} />
        <span className='sidebar-pet__label'>{toggleLabel}</span>
      </button>
      <span className='sr-only' role='status'>{playAnnouncement}</span>
      {isVisible && createPortal(<WindowPet photo={displayedPhoto} playRequest={playRequest} onReaction={announceReaction} />, document.body)}
    </section>
  );
});
