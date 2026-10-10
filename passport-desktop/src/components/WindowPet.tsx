import { memo, useLayoutEffect, useRef } from 'react';
import { useStore } from '../store';
import AppIcon from './ui/AppIcon';

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Reaction = { pose: string; line: string; duration: number };
type Drag = {
  pointerId: number;
  offset: Point;
  start: Point;
  box: Bounds;
  sample: Point;
  sampledAt: number;
  heading: number | null;
  turn: number;
  reversals: number;
  travel: number;
  moved: boolean;
  dizzyLine: string;
};
const width = 40;
const height = 58;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const reactions = [
  { pose: 'wave', line: 'Udah, lu tenang aja. Biar gua yang ngerjain.', duration: 1900 },
  { pose: 'dance', line: 'Kerjaan jalan, joget juga jalan.', duration: 2300 },
  { pose: 'hop', line: 'Kasih jalan, si paling sibuk mau lewat!', duration: 1800 },
  { pose: 'wave', line: 'Lu ngopi dulu, gua jagain di sini.', duration: 1900 },
  { pose: 'dance', line: 'Gua joget dulu. Biar nggak tegang.', duration: 2300 },
  { pose: 'hop', line: 'Gua muter dulu. Siapa tahu nemu motivasi.', duration: 1800 },
  { pose: 'wave', line: 'Santai, bos. Gua standby, lu tarik napas.', duration: 1900 },
  { pose: 'dance', line: 'Kalau beres, kita joget. Deal?', duration: 2300 },
  { pose: 'hop', line: 'Badan boleh kecil, gaya harus gede.', duration: 1800 },
  { pose: 'wave', line: 'Capek? Tos dulu sama gua!', duration: 1900 },
  { pose: 'dance', line: 'Biar nggak mumet, joget dulu dikit.', duration: 2300 },
  { pose: 'hop', line: 'Gua udah pemanasan. Lu udah?', duration: 1800 },
] as const;
const dizzyLines = [
  'Woi, dunia gua muter, bos!',
  'Pelan-pelan! Gua bukan blender!',
  'Stop dulu, gua loading keseimbangan.',
  'Lah, mejanya kok jadi komidi putar?!',
] as const;

export default memo(function WindowPet({ photo, playRequest, onReaction }: {
  photo: string;
  playRequest: number;
  onReaction: (line: string) => void;
}) {
  const spriteRef = useRef<HTMLDivElement>(null);
  const speechRef = useRef<HTMLSpanElement>(null);
  const grabRef = useRef<HTMLButtonElement>(null);
  const positionRef = useRef<Point | null>(null);
  const playRef = useRef<() => void>(() => {});
  const previousPlayRequest = useRef(playRequest);
  const reactionIndex = useRef(-1);
  const isBusy = useStore(state => state.isScanning || state.isStartingScan ||
    state.isStoppingScan || state.isPreparingImages || state.isEntryRunning);

  useLayoutEffect(() => {
    const sprite = spriteRef.current;
    const grab = grabRef.current;
    if (!sprite || !grab) return;
    const workspace = document.querySelector('.app-content-frame');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let focused = document.hasFocus();
    let motion: Animation | null = null;
    let restTimer: number | undefined;
    let reactionTimer: number | undefined;
    let speechTimer: number | undefined;
    let drag: Drag | null = null;
    const bounds = () => {
      const rect = workspace?.getBoundingClientRect();
      const left = (rect?.left || 0) + 8;
      const top = (rect?.top || 36) + 8;
      return { left, top, right: Math.max(left, innerWidth - width - 8),
        bottom: Math.max(top, innerHeight - height - 12) };
    };
    const place = (point: Point) => {
      positionRef.current = point;
      sprite.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    };
    const positionBubble = (point: Point) => {
      sprite.dataset.bubbleAlign = point.x > innerWidth - 164 ? 'right' : 'left';
      sprite.dataset.bubbleSide = point.y < 100 ? 'below' : 'above';
    };
    const cancelDrag = () => {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      sprite.dataset.dragging = 'false';
      sprite.style.removeProperty('--pet-drag-tilt');
      if (grab.hasPointerCapture(pointerId)) grab.releasePointerCapture(pointerId);
    };
    const stopWalk = () => {
      window.clearTimeout(restTimer);
      restTimer = undefined;
      if (motion) {
        // Keep the current position when focus, OCR, or window size changes.
        const matrix = new DOMMatrixReadOnly(getComputedStyle(sprite).transform);
        const point = { x: matrix.m41, y: matrix.m42 };
        motion.onfinish = null;
        motion.cancel();
        motion = null;
        place(point);
      }
      sprite.dataset.walking = 'false';
    };
    const stopReaction = () => {
      window.clearTimeout(reactionTimer);
      reactionTimer = undefined;
      sprite.dataset.pose = isBusy ? 'resting' : 'idle';
      sprite.dataset.dizzy = 'false';
      if (speechRef.current?.textContent) speechRef.current.textContent = '';
    };
    const stop = () => {
      cancelDrag();
      window.clearTimeout(speechTimer);
      speechTimer = undefined;
      stopWalk();
      stopReaction();
    };
    const canInteract = () => !isBusy && focused && !document.hidden &&
      !document.querySelector('[aria-modal="true"]');
    const canWalk = () => canInteract() && !drag && !reducedMotion.matches;
    const showReaction = (reaction: Reaction, announce: boolean) => {
      if (!canInteract() || drag) return;
      stop();
      sprite.dataset.pose = reaction.pose;
      sprite.dataset.dizzy = String(reaction.pose === 'dizzy');
      positionBubble(positionRef.current!);
      const duration = Math.max(reaction.duration, 1600 + reaction.line.length * 45);
      reactionTimer = window.setTimeout(() => { stopReaction(); syncPlayback(); }, duration);
      if (speechRef.current) speechRef.current.textContent = reaction.line;
      if (announce) onReaction(reaction.line);
    };
    const react = (manual: boolean) => {
      if (!canInteract() || drag) return;
      // Pick any line except the one that was just shown.
      let index = Math.floor(Math.random() * (reactions.length - (reactionIndex.current < 0 ? 0 : 1)));
      if (reactionIndex.current >= 0 && index >= reactionIndex.current) index += 1;
      reactionIndex.current = index;
      showReaction(reactions[index], manual);
    };
    playRef.current = () => react(true);
    const scheduleSpeech = () => {
      if (speechTimer !== undefined || reactionTimer !== undefined) return;
      // One sparse timeout also works when reduced motion keeps the pet still.
      speechTimer = window.setTimeout(() => {
        speechTimer = undefined;
        react(false);
      }, 12000 + Math.random() * 12000);
    };

    const walk = () => {
      restTimer = undefined;
      if (!canWalk()) return;
      const box = bounds();
      const start = positionRef.current!;
      const dx = box.left + Math.random() * (box.right - box.left) - start.x;
      const dy = box.top + Math.random() * (box.bottom - box.top) - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 8) {
        restTimer = window.setTimeout(walk, 4000);
        return;
      }
      const stride = Math.min(distance, 160 + Math.random() * 100);
      const next = { x: start.x + dx / distance * stride, y: start.y + dy / distance * stride };
      sprite.dataset.direction = dx < 0 ? 'left' : 'right';
      sprite.dataset.walking = 'true';
      // Transforms animate in the browser; JS runs only between short walks.
      motion = sprite.animate([
        { transform: `translate3d(${start.x}px, ${start.y}px, 0)` },
        { transform: `translate3d(${next.x}px, ${next.y}px, 0)` },
      ], { duration: clamp(stride / 36 * 1000, 1600, 7000), easing: 'linear', fill: 'forwards' });
      motion.onfinish = () => {
        place(next);
        motion?.cancel();
        motion = null;
        sprite.dataset.walking = 'false';
        if (canWalk()) restTimer = window.setTimeout(walk, 2500 + Math.random() * 3000);
      };
    };
    const syncPlayback = () => {
      sprite.dataset.paused = String(!canWalk());
      if (!canInteract()) {
        stop();
        return;
      }
      if (drag) return;
      scheduleSpeech();
      if (!canWalk()) stopWalk();
      else if (!motion && restTimer === undefined && reactionTimer === undefined) {
        restTimer = window.setTimeout(walk, 1800);
      }
    };
    const resize = () => {
      stop();
      const box = bounds();
      const point = positionRef.current || { x: box.left + 8, y: box.bottom };
      place({ x: clamp(point.x, box.left, box.right), y: clamp(point.y, box.top, box.bottom) });
      syncPlayback();
    };
    resize();
    sprite.dataset.ready = 'true';

    // Busy mode has no pet timers or DOM observer.
    if (isBusy) return stop;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || !canInteract()) return;
      event.preventDefault();
      stop();
      const point = positionRef.current!;
      drag = {
        pointerId: event.pointerId,
        offset: { x: event.clientX - point.x, y: event.clientY - point.y },
        start: point,
        box: bounds(),
        sample: point,
        sampledAt: event.timeStamp,
        heading: null,
        turn: 0,
        reversals: 0,
        travel: 0,
        moved: false,
        dizzyLine: '',
      };
      sprite.dataset.dragging = 'true';
      sprite.dataset.pose = 'held';
      sprite.dataset.paused = 'true';
      grab.focus({ preventScroll: true });
      grab.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!canInteract()) { stop(); return; }
      event.preventDefault();
      const point = {
        x: clamp(event.clientX - drag.offset.x, drag.box.left, drag.box.right),
        y: clamp(event.clientY - drag.offset.y, drag.box.top, drag.box.bottom),
      };
      place(point);
      const dx = point.x - drag.sample.x;
      const dy = point.y - drag.sample.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= 4) {
        drag.moved = true;
        const elapsed = Math.max(1, event.timeStamp - drag.sampledAt);
        const heading = Math.atan2(dy, dx);
        // Only sustained quick circles or repeated reversals cause dizziness.
        if (elapsed > 250 || distance / elapsed < 0.22) {
          drag.turn = 0;
          drag.reversals = 0;
          drag.travel = 0;
        } else {
          drag.travel += distance;
          if (drag.heading !== null) {
            const change = Math.abs(Math.atan2(Math.sin(heading - drag.heading), Math.cos(heading - drag.heading)));
            if (change > Math.PI * 0.72) drag.reversals += 1;
            else drag.turn += change;
          }
        }
        drag.heading = heading;
        drag.sample = point;
        drag.sampledAt = event.timeStamp;
        if (!reducedMotion.matches) {
          sprite.style.setProperty('--pet-drag-tilt', `${clamp(dx / elapsed * 6, -14, 14)}deg`);
        }
        if (!drag.dizzyLine && drag.travel >= 240 && (drag.turn >= Math.PI * 2 || drag.reversals >= 4)) {
          drag.dizzyLine = dizzyLines[Math.floor(Math.random() * dizzyLines.length)];
          sprite.dataset.dizzy = 'true';
          if (speechRef.current) speechRef.current.textContent = drag.dizzyLine;
          onReaction(drag.dizzyLine);
        }
      }
      if (drag.dizzyLine) positionBubble(point);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { moved, dizzyLine } = drag;
      cancelDrag();
      if (event.type !== 'pointerup' || !canInteract()) {
        stopReaction();
        syncPlayback();
      } else if (dizzyLine) {
        showReaction({ pose: 'dizzy', line: dizzyLine, duration: 3800 }, false);
      } else if (moved) {
        showReaction({ pose: 'wave', line: 'Pelan-pelan, bos. Gua bukan koper!', duration: 1900 }, true);
      } else react(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canInteract()) return;
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        event.stopPropagation();
        const start = drag.start;
        stop();
        place(start);
        syncPlayback();
        return;
      }
      if (drag) return;
      const step = event.shiftKey ? 32 : 16;
      const directions: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        stop();
        const point = positionRef.current!;
        const box = bounds();
        place({ x: clamp(point.x + direction.x, box.left, box.right), y: clamp(point.y + direction.y, box.top, box.bottom) });
        if (direction.x) sprite.dataset.direction = direction.x < 0 ? 'left' : 'right';
        syncPlayback();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) showReaction({ pose: 'dizzy', line: dizzyLines[Math.floor(Math.random() * dizzyLines.length)], duration: 3800 }, true);
      }
    };
    grab.addEventListener('pointerdown', onPointerDown);
    grab.addEventListener('pointermove', onPointerMove);
    grab.addEventListener('pointerup', onPointerEnd);
    grab.addEventListener('pointercancel', onPointerEnd);
    grab.addEventListener('lostpointercapture', onPointerEnd);
    grab.addEventListener('keydown', onKeyDown);
    const onBlur = () => { focused = false; syncPlayback(); };
    const onFocus = () => { focused = true; syncPlayback(); };
    const onVisibility = () => { focused = document.hasFocus(); syncPlayback(); };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', syncPlayback);
    const sizeObserver = new ResizeObserver(resize);
    if (workspace) sizeObserver.observe(workspace);
    // Child-list observation catches dialogs; transform animation cannot trigger it.
    const dialogsObserver = new MutationObserver(syncPlayback);
    dialogsObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      stop();
      playRef.current = () => {};
      sizeObserver.disconnect();
      dialogsObserver.disconnect();
      grab.removeEventListener('pointerdown', onPointerDown);
      grab.removeEventListener('pointermove', onPointerMove);
      grab.removeEventListener('pointerup', onPointerEnd);
      grab.removeEventListener('pointercancel', onPointerEnd);
      grab.removeEventListener('lostpointercapture', onPointerEnd);
      grab.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', syncPlayback);
    };
  }, [isBusy, onReaction]);

  useLayoutEffect(() => {
    if (playRequest !== previousPlayRequest.current) {
      previousPlayRequest.current = playRequest;
      playRef.current();
    }
  }, [playRequest]);

  return (
    <div className="window-pet-stage">
      <div ref={spriteRef} className="window-pet" data-walking="false" data-direction="right">
        <span ref={speechRef} className="window-pet__speech" aria-hidden="true" />
        <span className="window-pet__rest-mark" aria-hidden="true">Zz</span>
        <span className="window-pet__dizzy-mark" aria-hidden="true">✦ · ✦</span>
        <span className="window-pet__ground" aria-hidden="true" />
        <button
          ref={grabRef}
          type="button"
          className="window-pet__grab"
          disabled={isBusy}
          aria-label="Geser pet. Tombol panah untuk menggeser, Enter untuk membuat pet pusing."
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter"
          title="Tarik gua pakai mouse. Tapi jangan diputer terus, gua bisa pusing!"
        />
        <div className="window-pet__figure" aria-hidden="true">
          <div className="window-pet__head">
            {photo ? <img src={photo} alt="" draggable={false} /> : <AppIcon name="user" size={20} />}
          </div>
          <svg className="window-pet__body" viewBox="0 0 40 30" focusable="false">
            <g className="window-pet__leg window-pet__leg--back">
              <rect className="window-pet__pants" x="21" y="14" width="6" height="9" rx="3" />
              <path className="window-pet__shoe" d="M21 21h5q4 0 4 3v2H20v-3q0-2 1-2Z" />
              <path className="window-pet__sole" d="M21 25h8" />
            </g>
            <g className="window-pet__leg window-pet__leg--front">
              <rect className="window-pet__pants" x="13" y="14" width="6" height="9" rx="3" />
              <path className="window-pet__shoe" d="M14 21h5v5H9v-2q0-3 5-3Z" />
              <path className="window-pet__sole" d="M10 25h8" />
            </g>
            <g className="window-pet__arm window-pet__arm--back">
              <path className="window-pet__sleeve" d="m25 5 5 7" />
              <circle className="window-pet__hand" cx="31" cy="14" r="2.4" />
            </g>
            <path className="window-pet__shirt" d="M17 1h6l5 5-1 11q-7 3-14 0L12 6Z" />
            <path className="window-pet__collar" d="m17 2 3 3 3-3" />
            <path className="window-pet__seam" d="M20 6v11m-4-5v2q4 2 8 0v-2" />
            <rect className="window-pet__badge" x="22" y="7" width="3" height="4" rx="0.7" />
            <g className="window-pet__arm window-pet__arm--front">
              <path className="window-pet__sleeve" d="m15 5-5 7" />
              <circle className="window-pet__hand" cx="9" cy="14" r="2.4" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
});
