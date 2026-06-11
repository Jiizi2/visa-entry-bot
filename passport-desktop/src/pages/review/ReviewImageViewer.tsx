import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getEffectiveImagePath } from '../../utils/paths';

interface ReviewImageViewerProps {
  activeMember: any;
  manifestPath?: string;
}

export default function ReviewImageViewer({ activeMember, manifestPath }: ReviewImageViewerProps) {
  const [activeImageData, setActiveImageData] = useState<{dataUrl?: string}>({});
  const [zoom, setZoom] = useState(1);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (activeMember && manifestPath) {
      const loadImg = async () => {
        try {
          const res: any = await invoke('load_passport_image_data', {
            manifestPath: manifestPath,
            imagePath: getEffectiveImagePath(activeMember),
            fileName: activeMember.fileName || '',
          });
          setActiveImageData(res || {});
          setZoom(1); // Reset zoom on new image
        } catch (e) {
          console.error(e);
          setActiveImageData({});
        }
      };
      loadImg();
    } else {
      setActiveImageData({});
    }
  }, [activeMember, manifestPath]);

  // Handle Ctrl+Scroll to zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(z => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          return Math.min(Math.max(0.5, z + delta), 5);
        });
      }
    };
    const el = imgContainerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (imgContainerRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setScrollStart({ 
        x: imgContainerRef.current.scrollLeft, 
        y: imgContainerRef.current.scrollTop 
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && imgContainerRef.current) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      imgContainerRef.current.scrollLeft = scrollStart.x - dx;
      imgContainerRef.current.scrollTop = scrollStart.y - dy;
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="flex-1 overflow-auto flex items-center justify-center relative">
      <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] bg-[size:20px_20px]"></div>
      <div className="relative w-full h-full flex flex-col bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden">
        <div className="p-3 px-4 border-b border-slate-300/50 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-[14px] leading-[20px] font-semibold tracking-wider text-slate-600 flex items-center gap-2 m-0">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>description</span> Source Document
          </h3>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">Passport Preview</span>
          <div className="flex bg-white rounded shadow-sm border border-slate-300/50 overflow-hidden ml-4" title="Gunakan Ctrl + Scroll untuk Zoom">
            <button className="p-1.5 text-slate-600 bg-transparent cursor-pointer transition-colors flex items-center justify-center hover:bg-slate-100 border-none" title="Zoom Out" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>remove</span>
            </button>
            <div className="px-2 py-1 border-x border-slate-300/50 text-[12px] font-medium flex items-center bg-slate-50">
              {Math.round(zoom * 100)}%
            </div>
            <button className="p-1.5 text-slate-600 bg-transparent cursor-pointer transition-colors flex items-center justify-center hover:bg-slate-100 border-none" title="Zoom In" onClick={() => setZoom(z => Math.min(5, z + 0.25))}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add</span>
            </button>
          </div>
        </div>
        <div 
          className="flex-1 overflow-auto flex items-center justify-center bg-slate-100/50"
          ref={imgContainerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ 
            cursor: isDragging ? 'grabbing' : 'grab',
            display: 'block',
            position: 'relative'
          }}
        >
          <div style={{
            width: `${zoom * 100}%`,
            minWidth: '100%',
            minHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: isDragging ? 'none' : 'width 0.2s ease-out'
          }}>
            {activeImageData.dataUrl ? (
                <img 
                  alt="Scanned passport document view" 
                  src={activeImageData.dataUrl}
                  draggable={false}
                  style={{ 
                    width: '100%', 
                    height: 'auto', 
                    maxHeight: zoom <= 1 ? '75vh' : 'none',
                    objectFit: 'contain',
                    mixBlendMode: 'multiply',
                    pointerEvents: 'none'
                  }} 
                />
            ) : (
                <div style={{ padding: '40px', color: '#737686', fontSize: '14px' }}>Tidak ada gambar</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
