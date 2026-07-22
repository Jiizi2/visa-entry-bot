import { useEffect, useRef } from 'react';
import AppIcon from './ui/AppIcon';

export interface CompletionMoment {
  image: string;
  title: string;
  description: string;
  alt: string;
}

interface CompletionOverlayProps {
  moment: CompletionMoment;
  onClose: () => void;
}

export default function CompletionOverlay({ moment, onClose }: CompletionOverlayProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="completion-overlay" role="presentation">
      <section
        aria-describedby="completion-moment-description"
        aria-labelledby="completion-moment-title"
        aria-modal="true"
        className="completion-overlay__dialog"
        role="dialog"
      >
        <img className="completion-overlay__image" src={moment.image} alt={moment.alt} />
        <footer className="completion-overlay__footer">
          <div className="completion-overlay__copy">
            <strong id="completion-moment-title">{moment.title}</strong>
            <span id="completion-moment-description">{moment.description}</span>
          </div>
          <button
            ref={closeButtonRef}
            className="primary-action completion-overlay__close"
            type="button"
            onClick={onClose}
          >
            Lanjutkan
            <AppIcon name="arrow_forward" size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
