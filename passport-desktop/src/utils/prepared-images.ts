export interface PassportImageRequest {
  manifestPath: string;
  imagePath: string;
  fileName: string;
}

export interface PassportImageData {
  path: string;
  dataUrl: string;
}

export const passportImageRequestKey = (request: PassportImageRequest) =>
  JSON.stringify([request.manifestPath, request.imagePath, request.fileName]);

/** Share a photo read between the preview and queue, keeping only one page in memory. */
export function createPreparedImageLoader(
  readImage: (request: PassportImageRequest) => Promise<PassportImageData | null>,
  cacheLimit = 8,
) {
  const cache = new Map<string, PassportImageData | null>();
  const pending = new Map<string, Promise<PassportImageData | null>>();

  return {
    load(request: PassportImageRequest): Promise<PassportImageData | null> {
      const key = passportImageRequestKey(request);
      if (cache.has(key)) {
        const data = cache.get(key)!;
        cache.delete(key);
        cache.set(key, data);
        return Promise.resolve(data);
      }
      const existing = pending.get(key);
      if (existing) return existing;

      const promise = Promise.resolve().then(() => readImage(request)).then(data => {
        // An edit can replace this request while its original read is still running.
        if (pending.get(key) === promise) {
          cache.set(key, data);
          while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
        }
        return data;
      }).finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
      return promise;
    },
    invalidate(request: PassportImageRequest) {
      const key = passportImageRequestKey(request);
      cache.delete(key);
      pending.delete(key);
    },
  };
}

/** Queue images are displayed at 64 × 80; allow twice that density for sharp thumbnails. */
export function createPassportThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const scale = Math.min(1, 128 / image.naturalWidth, 160 / image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Pratinjau foto tidak dapat dibuat.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('Foto passport tidak dapat dibaca.'));
    image.src = dataUrl;
  });
}
