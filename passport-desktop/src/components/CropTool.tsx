import Button from './ui/Button';
import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropToolProps {
  imageSrc: string;
  initialRect?: CropRect;
  onSave: (dataUrl: string, rect: CropRect) => void;
  onCancel: () => void;
}

const PASSPORT_CROP_MIN_IMAGE_SIZE = 48;
const PASSPORT_CROP_HANDLE_SIZE = 12;
const PASSPORT_CROP_OUTPUT_TYPE = "image/jpeg";
const PASSPORT_CROP_OUTPUT_QUALITY = 0.92;

interface ImageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

const normalizeCropRect = (rect: Partial<CropRect>, imageWidth: number, imageHeight: number): CropRect => {
  const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, imageWidth, imageHeight);
  const width = Math.max(minSize, Math.min(imageWidth, Number(rect?.width) || imageWidth));
  const height = Math.max(minSize, Math.min(imageHeight, Number(rect?.height) || imageHeight));
  const x = Math.min(Math.max(0, Number(rect?.x) || 0), Math.max(0, imageWidth - width));
  const y = Math.min(Math.max(0, Number(rect?.y) || 0), Math.max(0, imageHeight - height));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
};

const defaultPassportCropRect = (imageWidth: number, imageHeight: number): CropRect => {
  const insetX = Math.round(imageWidth * 0.06);
  const insetY = Math.round(imageHeight * 0.06);
  return normalizeCropRect({
    x: insetX,
    y: insetY,
    width: imageWidth - (insetX * 2),
    height: imageHeight - (insetY * 2),
  }, imageWidth, imageHeight);
};

const imageFrameForCanvas = (canvas: HTMLCanvasElement, sourceImage: HTMLImageElement, zoom: number): ImageFrame => {
  const padding = 18;
  const availableWidth = Math.max(1, canvas.width - (padding * 2));
  const availableHeight = Math.max(1, canvas.height - (padding * 2));
  const fitScale = Math.min(availableWidth / sourceImage.naturalWidth, availableHeight / sourceImage.naturalHeight);
  const scale = fitScale * zoom;
  const width = sourceImage.naturalWidth * scale;
  const height = sourceImage.naturalHeight * scale;
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height, scale };
};

const canvasRectFromCrop = (rect: CropRect, frame: ImageFrame): CropRect => ({
  x: frame.x + (rect.x * frame.scale),
  y: frame.y + (rect.y * frame.scale),
  width: rect.width * frame.scale,
  height: rect.height * frame.scale,
});

const cropHandlePoints = (rect: CropRect) => {
  const x1 = rect.x, y1 = rect.y, x2 = rect.x + rect.width, y2 = rect.y + rect.height;
  const midX = rect.x + (rect.width / 2), midY = rect.y + (rect.height / 2);
  return [
    { mode: "nw", x: x1, y: y1 }, { mode: "n", x: midX, y: y1 }, { mode: "ne", x: x2, y: y1 },
    { mode: "e", x: x2, y: midY }, { mode: "se", x: x2, y: y2 }, { mode: "s", x: midX, y: y2 },
    { mode: "sw", x: x1, y: y2 }, { mode: "w", x: x1, y: midY },
  ];
};

export default function CropTool({ imageSrc, initialRect, onSave, onCancel }: CropToolProps) {
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const cropRectRef = useRef<CropRect | null>(null);
  const frameRef = useRef<ImageFrame | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundDirtyRef = useRef(true);
  
  // Interaction state
  const interactionRef = useRef<{ mode: string, pointerId: number, startPoint: {x:number, y:number}, startRect: CropRect } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const background = backgroundCanvasRef.current;
    const image = imageRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !background || !image || !cropRect) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The full-resolution photo stays on its own canvas throughout a drag.
    if (backgroundDirtyRef.current || !frameRef.current) {
      const backgroundContext = background.getContext('2d', { alpha: false });
      if (!backgroundContext) return;
      const frame = imageFrameForCanvas(canvas, image, zoomRef.current);
      backgroundContext.fillStyle = "#111827";
      backgroundContext.fillRect(0, 0, background.width, background.height);
      backgroundContext.drawImage(image, frame.x, frame.y, frame.width, frame.height);
      frameRef.current = frame;
      backgroundDirtyRef.current = false;
    }

    const frame = frameRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw overlay
    const rect = canvasRectFromCrop(cropRect, frame);
    ctx.save();
    ctx.fillStyle = "rgba(9, 15, 25, 0.62)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fill("evenodd");

    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    
    // Grid lines
    ctx.strokeStyle = "rgba(248, 250, 252, 0.58)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x + (rect.width / 3), rect.y);
    ctx.lineTo(rect.x + (rect.width / 3), rect.y + rect.height);
    ctx.moveTo(rect.x + ((rect.width * 2) / 3), rect.y);
    ctx.lineTo(rect.x + ((rect.width * 2) / 3), rect.y + rect.height);
    ctx.moveTo(rect.x, rect.y + (rect.height / 3));
    ctx.lineTo(rect.x + rect.width, rect.y + (rect.height / 3));
    ctx.moveTo(rect.x, rect.y + ((rect.height * 2) / 3));
    ctx.lineTo(rect.x + rect.width, rect.y + ((rect.height * 2) / 3));
    ctx.stroke();

    // Handles
    ctx.fillStyle = "#f8fafc";
    const handles = cropHandlePoints(rect);
    for (const handle of handles) {
      ctx.fillRect(handle.x - 5, handle.y - 5, 10, 10);
    }
    ctx.restore();
  }, []);

  const scheduleDraw = useCallback((redrawBackground = false) => {
    backgroundDirtyRef.current ||= redrawBackground;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      cropRectRef.current = initialRect
        ? normalizeCropRect(initialRect, img.naturalWidth, img.naturalHeight)
        : defaultPassportCropRect(img.naturalWidth, img.naturalHeight);
      scheduleDraw(true);
    };
    img.src = imageSrc;
    return () => {
      img.onload = null;
      imageRef.current = null;
      cropRectRef.current = null;
      frameRef.current = null;
      interactionRef.current = null;
    };
  }, [imageSrc, initialRect, scheduleDraw]);

  useEffect(() => {
    zoomRef.current = zoom;
    scheduleDraw(true);
  }, [zoom, scheduleDraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleResize = () => {
      const canvas = canvasRef.current;
      const background = backgroundCanvasRef.current;
      if (!canvas || !background) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = background.width = width;
        canvas.height = background.height = height;
        frameRef.current = null;
        interactionRef.current = null;
        scheduleDraw(true);
      }
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [scheduleDraw]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
      y: (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
    };
  };

  const getImagePoint = (canvasPoint: {x:number, y:number}, clamp = false) => {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame) return null;
    const rawX = (canvasPoint.x - frame.x) / frame.scale;
    const rawY = (canvasPoint.y - frame.y) / frame.scale;
    if (!clamp && (rawX < 0 || rawY < 0 || rawX > image.naturalWidth || rawY > image.naturalHeight)) return null;
    return {
      x: Math.min(image.naturalWidth, Math.max(0, rawX)),
      y: Math.min(image.naturalHeight, Math.max(0, rawY)),
    };
  };

  const hitTest = (point: {x:number, y:number}) => {
    const cropRect = cropRectRef.current;
    const frame = frameRef.current;
    if (!cropRect || !frame) return "";
    const rect = canvasRectFromCrop(cropRect, frame);
    for (const handle of cropHandlePoints(rect)) {
      if (Math.abs(point.x - handle.x) <= PASSPORT_CROP_HANDLE_SIZE && Math.abs(point.y - handle.y) <= PASSPORT_CROP_HANDLE_SIZE) {
        return handle.mode;
      }
    }
    if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
      return "move";
    }
    return "";
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cropRect = cropRectRef.current;
    if (!imageRef.current || !cropRect || interactionRef.current || e.button !== 0) return;
    const point = getCanvasPoint(e);
    const imagePoint = getImagePoint(point);
    if (!imagePoint) return;
    const mode = hitTest(point);
    if (!mode) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    interactionRef.current = { mode, pointerId: e.pointerId, startPoint: imagePoint, startRect: { ...cropRect } };
  };

  const updateCropFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    const image = imageRef.current;
    if (!interaction || interaction.pointerId !== e.pointerId || !image) return;
    const point = getCanvasPoint(e);
    const imagePoint = getImagePoint(point, true);
    if (!imagePoint) return;

    const { mode, startPoint, startRect } = interaction;
    const dx = imagePoint.x - startPoint.x;
    const dy = imagePoint.y - startPoint.y;

    const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, image.naturalWidth, image.naturalHeight);
    if (mode === "move") {
      cropRectRef.current = normalizeCropRect({
        ...startRect,
        x: Math.min(Math.max(0, startRect.x + dx), image.naturalWidth - startRect.width),
        y: Math.min(Math.max(0, startRect.y + dy), image.naturalHeight - startRect.height),
      }, image.naturalWidth, image.naturalHeight);
    } else {
      let left = startRect.x, top = startRect.y, right = startRect.x + startRect.width, bottom = startRect.y + startRect.height;
      if (mode.includes("w")) left = Math.min(right - minSize, Math.max(0, startRect.x + dx));
      if (mode.includes("e")) right = Math.max(left + minSize, Math.min(image.naturalWidth, startRect.x + startRect.width + dx));
      if (mode.includes("n")) top = Math.min(bottom - minSize, Math.max(0, startRect.y + dy));
      if (mode.includes("s")) bottom = Math.max(top + minSize, Math.min(image.naturalHeight, startRect.y + startRect.height + dy));
      
      cropRectRef.current = normalizeCropRect({ x: left, y: top, width: right - left, height: bottom - top }, image.naturalWidth, image.naturalHeight);
    }
    // Keep the latest crop immediately available to Save; paint at most once per frame.
    scheduleDraw();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactionRef.current) {
      const mode = hitTest(getCanvasPoint(e));
      const cursor = mode === "move" ? "move" : mode ? `${mode}-resize` : "default";
      if (e.currentTarget.style.cursor !== cursor) e.currentTarget.style.cursor = cursor;
      return;
    }
    e.preventDefault();
    updateCropFromPointer(e);
  };

  const endInteraction = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactionRef.current || interactionRef.current.pointerId !== e.pointerId) return;
    interactionRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    updateCropFromPointer(e);
    endInteraction(e);
  };

  const handleSave = () => {
    const image = imageRef.current;
    const cropRect = cropRectRef.current;
    if (!image || !cropRect) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropRect.width));
    canvas.height = Math.max(1, Math.round(cropRect.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL(PASSPORT_CROP_OUTPUT_TYPE, PASSPORT_CROP_OUTPUT_QUALITY);
    onSave(dataUrl, cropRect);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-8">
      <div className="crop-dialog flex flex-col w-full h-full max-w-6xl max-h-[90vh] overflow-hidden border">
        <div className="crop-dialog__header flex justify-between items-center p-4 border-b shrink-0">
          <h3 className="m-0 text-white type-body-large-strong">Crop foto passport</h3>
          <div className="flex items-center gap-4">
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} className="w-32 cursor-pointer accent-blue-500" />
            <Button variant="primary" onClick={handleSave} className="primary-action">Simpan crop</Button>
            <Button variant="secondary" onClick={onCancel} className="secondary-button">Batal</Button>
          </div>
        </div>
        <div ref={containerRef} className="flex-1 w-full min-h-[400px] relative cursor-crosshair">
          <canvas ref={backgroundCanvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full block pointer-events-none" />
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={endInteraction}
            onLostPointerCapture={endInteraction}
            className="absolute inset-0 w-full h-full block touch-none"
          />
        </div>
      </div>
    </div>
  );
}
