import React, { useRef, useEffect, useState, useMemo } from 'react';

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

export default function CropTool({ imageSrc, initialRect, onSave, onCancel }: CropToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  
  // Interaction state
  const interactionRef = useRef<{ mode: string, pointerId: number, startPoint: {x:number, y:number}, startRect: CropRect } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      if (initialRect) {
        setCropRect(normalizeCropRect(initialRect, img.naturalWidth, img.naturalHeight));
      } else {
        setCropRect(defaultPassportCropRect(img.naturalWidth, img.naturalHeight));
      }
    };
    img.src = imageSrc;
  }, [imageSrc]);

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

  const normalizeCropRect = (rect: Partial<CropRect>, imageWidth: number, imageHeight: number): CropRect => {
    const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, imageWidth, imageHeight);
    const width = Math.max(minSize, Math.min(imageWidth, Number(rect?.width) || imageWidth));
    const height = Math.max(minSize, Math.min(imageHeight, Number(rect?.height) || imageHeight));
    const x = Math.min(Math.max(0, Number(rect?.x) || 0), Math.max(0, imageWidth - width));
    const y = Math.min(Math.max(0, Number(rect?.y) || 0), Math.max(0, imageHeight - height));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !cropRect) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const frame = imageFrameForCanvas(canvas, image, zoom);
    ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);

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
  };

  useEffect(() => {
    draw();
  }, [image, cropRect, zoom]);

  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (container && canvas) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        draw();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [image]);

  const imageFrameForCanvas = (canvas: HTMLCanvasElement, sourceImage: HTMLImageElement, z: number) => {
    const padding = 18;
    const availableWidth = Math.max(1, canvas.width - (padding * 2));
    const availableHeight = Math.max(1, canvas.height - (padding * 2));
    const fitScale = Math.min(availableWidth / sourceImage.naturalWidth, availableHeight / sourceImage.naturalHeight);
    const scale = fitScale * z;
    const width = sourceImage.naturalWidth * scale;
    const height = sourceImage.naturalHeight * scale;
    return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height, scale };
  };

  const canvasRectFromCrop = (rect: CropRect, frame: any) => ({
    x: frame.x + (rect.x * frame.scale),
    y: frame.y + (rect.y * frame.scale),
    width: rect.width * frame.scale,
    height: rect.height * frame.scale,
  });

  const cropHandlePoints = (rect: any) => {
    const x1 = rect.x, y1 = rect.y, x2 = rect.x + rect.width, y2 = rect.y + rect.height;
    const midX = rect.x + (rect.width / 2), midY = rect.y + (rect.height / 2);
    return [
      { mode: "nw", x: x1, y: y1 }, { mode: "n", x: midX, y: y1 }, { mode: "ne", x: x2, y: y1 },
      { mode: "e", x: x2, y: midY }, { mode: "se", x: x2, y: y2 }, { mode: "s", x: midX, y: y2 },
      { mode: "sw", x: x1, y: y2 }, { mode: "w", x: x1, y: midY },
    ];
  };

  const getCanvasPoint = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return {x:0, y:0};
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getImagePoint = (canvasPoint: {x:number, y:number}, clamp = false) => {
    if (!image || !canvasRef.current) return null;
    const frame = imageFrameForCanvas(canvasRef.current, image, zoom);
    const rawX = (canvasPoint.x - frame.x) / frame.scale;
    const rawY = (canvasPoint.y - frame.y) / frame.scale;
    if (!clamp && (rawX < 0 || rawY < 0 || rawX > image.naturalWidth || rawY > image.naturalHeight)) return null;
    return {
      x: Math.min(image.naturalWidth, Math.max(0, rawX)),
      y: Math.min(image.naturalHeight, Math.max(0, rawY)),
    };
  };

  const hitTest = (point: {x:number, y:number}) => {
    if (!cropRect || !image || !canvasRef.current) return "";
    const frame = imageFrameForCanvas(canvasRef.current, image, zoom);
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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!image || !cropRect) return;
    const point = getCanvasPoint(e);
    const imagePoint = getImagePoint(point);
    if (!imagePoint) return;
    const mode = hitTest(point);
    if (!mode) return;

    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    interactionRef.current = { mode, pointerId: e.pointerId, startPoint: imagePoint, startRect: { ...cropRect } };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const point = getCanvasPoint(e);
    if (!interactionRef.current) {
      const mode = hitTest(point);
      const cursor = mode === "move" ? "move" : mode ? `${mode}-resize` : "default";
      if (canvasRef.current) canvasRef.current.style.cursor = cursor;
      return;
    }
    
    e.preventDefault();
    const imagePoint = getImagePoint(point, true);
    if (!imagePoint || !image) return;

    const { mode, startPoint, startRect } = interactionRef.current;
    const dx = imagePoint.x - startPoint.x;
    const dy = imagePoint.y - startPoint.y;

    const minSize = Math.min(PASSPORT_CROP_MIN_IMAGE_SIZE, image.naturalWidth, image.naturalHeight);
    if (mode === "move") {
      setCropRect(normalizeCropRect({
        ...startRect,
        x: Math.min(Math.max(0, startRect.x + dx), image.naturalWidth - startRect.width),
        y: Math.min(Math.max(0, startRect.y + dy), image.naturalHeight - startRect.height),
      }, image.naturalWidth, image.naturalHeight));
    } else {
      let left = startRect.x, top = startRect.y, right = startRect.x + startRect.width, bottom = startRect.y + startRect.height;
      if (mode.includes("w")) left = Math.min(right - minSize, Math.max(0, startRect.x + dx));
      if (mode.includes("e")) right = Math.max(left + minSize, Math.min(image.naturalWidth, startRect.x + startRect.width + dx));
      if (mode.includes("n")) top = Math.min(bottom - minSize, Math.max(0, startRect.y + dy));
      if (mode.includes("s")) bottom = Math.max(top + minSize, Math.min(image.naturalHeight, startRect.y + startRect.height + dy));
      
      setCropRect(normalizeCropRect({ x: left, y: top, width: right - left, height: bottom - top }, image.naturalWidth, image.naturalHeight));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!interactionRef.current || interactionRef.current.pointerId !== e.pointerId) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    interactionRef.current = null;
  };

  const handleSave = () => {
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
      <div className="flex flex-col w-full h-full max-w-6xl max-h-[90vh] bg-[#090f19] rounded-2xl shadow-2xl overflow-hidden border border-slate-700/50">
        <div className="flex justify-between items-center p-4 bg-[#111827] border-b border-slate-800 shrink-0">
          <h3 className="m-0 text-white font-semibold">Crop Foto Passport</h3>
          <div className="flex items-center gap-4">
            <input type="range" min="0.75" max="2" step="0.05" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} className="w-32 cursor-pointer accent-blue-500" />
            <button onClick={handleSave} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">Simpan Crop</button>
            <button onClick={onCancel} className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors">Batal</button>
          </div>
        </div>
        <div ref={containerRef} className="flex-1 w-full min-h-[400px] relative cursor-crosshair">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="w-full h-full block"
          />
        </div>
      </div>
    </div>
  );
}
