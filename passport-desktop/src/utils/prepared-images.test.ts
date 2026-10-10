import { describe, expect, it, vi } from 'vitest';
import { createPreparedImageLoader, type PassportImageData, type PassportImageRequest } from './prepared-images';

const request = (imagePath = 'C:/batch/photo.jpg'): PassportImageRequest => ({
  manifestPath: '', imagePath, fileName: 'photo.jpg',
});
const image = (dataUrl = 'original'): PassportImageData => ({ path: 'C:/batch/photo.jpg', dataUrl });

describe('Prepare photo loading', () => {
  it('shares an in-flight read between the active preview and thumbnail, and reuses it on rerenders', async () => {
    let finish!: (result: PassportImageData) => void;
    const readImage = vi.fn(() => new Promise<PassportImageData>(resolve => { finish = resolve; }));
    const loader = createPreparedImageLoader(readImage);
    const preview = loader.load(request());
    const thumbnail = loader.load(request());
    expect(preview).toBe(thumbnail);
    await Promise.resolve();
    finish(image());
    expect(await preview).toEqual(image());
    expect(await loader.load(request())).toEqual(image());
    expect(readImage).toHaveBeenCalledTimes(1);
  });

  it('keeps a recently edited photo when an older read finishes afterward', async () => {
    let finishOldRead!: (result: PassportImageData) => void;
    const readImage = vi.fn()
      .mockImplementationOnce(() => new Promise<PassportImageData>(resolve => { finishOldRead = resolve; }))
      .mockResolvedValue(image('edited'));
    const loader = createPreparedImageLoader(readImage);
    const previous = loader.load(request());
    await Promise.resolve();
    loader.invalidate(request());
    expect(await loader.load(request())).toEqual(image('edited'));
    finishOldRead(image());
    await previous;
    expect(await loader.load(request())).toEqual(image('edited'));
    expect(readImage).toHaveBeenCalledTimes(2);
  });

  it('retries failed reads and distinguishes the same file name in another folder', async () => {
    const readImage = vi.fn().mockRejectedValueOnce(new Error('File unavailable')).mockResolvedValue(image());
    const loader = createPreparedImageLoader(readImage);
    await expect(loader.load(request())).rejects.toThrow('File unavailable');
    await loader.load(request());
    await loader.load(request('C:/another-batch/photo.jpg'));
    expect(readImage).toHaveBeenCalledTimes(3);
  });

  it('bounds cached full-resolution photos while retaining the most recently used one', async () => {
    const readImage = vi.fn(async (input: PassportImageRequest) => ({ path: input.imagePath, dataUrl: input.imagePath }));
    const loader = createPreparedImageLoader(readImage, 2);
    await loader.load(request('one'));
    await loader.load(request('two'));
    await loader.load(request('one'));
    await loader.load(request('three'));
    await loader.load(request('one'));
    expect(readImage).toHaveBeenCalledTimes(3);
    await loader.load(request('two'));
    expect(readImage).toHaveBeenCalledTimes(4);
  });
});
