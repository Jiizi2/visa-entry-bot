import { describe, expect, it, vi } from 'vitest';
import { createEntryBatchExporter, prepareEntryBatch, type EntryBatchSource } from './entry-batch';

const source = (): EntryBatchSource => ({
  manifestPath: 'C:/batch-a/manifest.json', isScanning: false, selectedIds: new Set(), reviewedMemberIds: new Set(['a-4']),
  manifest: { members: [{ id: 'a-4', reviewStatus: 'VALID', passportImagePath: 'C:/batch-a/4.jpg', resolvedProfile: { firstName: 'MEMBER A', passportNumber: 'A000004', dob: '1980-01-01' } }] },
});

describe('automatic entry file', () => {
  it('requires all reviewable passports to be reviewed before exporting', () => {
    const input = source();
    input.manifest.members.push({ id: 'unreviewed', reviewStatus: 'VALID' });
    expect(prepareEntryBatch(input).request).toBeNull();
    input.manifest.members[1].reviewStatus = 'ERROR';
    expect(prepareEntryBatch(input).request?.memberCount).toBe(1);
    input.isScanning = true;
    expect(prepareEntryBatch(input).request).toBeNull();
  });
  it('keeps the reviewed profile and crop belonging to the same member', () => {
    const input = source();
    input.manifest.members[0].croppedPassportImagePath = 'C:/batch-a/crop-4.jpg';
    input.manifest.members.push({ id: 'b-1', reviewStatus: 'VALID', reviewConfirmed: true, passportImagePath: 'C:/batch-b/1.jpg', resolvedProfile: { firstName: 'MEMBER B', passportNumber: 'B000001', dob: '1980-01-01' } });
    const prepared = prepareEntryBatch(input).request!;
    expect(prepared.manifestData.members[0]).toMatchObject({ id: 'a-4', passportImagePath: 'C:/batch-a/crop-4.jpg', resolvedProfile: { firstName: 'MEMBER A', passportNumber: 'A000004' } });
    expect(input.manifest.members[0].reviewConfirmed).toBeUndefined();
    const next = source(); next.manifestPath = 'C:/batch-b/manifest.json';
    expect(prepareEntryBatch(next).request!.signature).not.toBe(prepared.signature);
  });
  it('serializes exports and coalesces an in-flight duplicate from StrictMode', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const writes: string[] = [];
    const invoke = vi.fn(async (command, args) => {
      writes.push(`${command}:${args.manifestPath}`);
      if (writes.length === 1) await pending;
      return `${args.manifestPath}.json`;
    });
    const exportFile = createEntryBatchExporter(invoke as any);
    const first = prepareEntryBatch(source()).request!;
    const next = source(); next.manifestPath = 'C:/batch-b/manifest.json';
    const second = prepareEntryBatch(next).request!;
    const a = exportFile(first);
    expect(exportFile(first)).toBe(a);
    const b = exportFile(second);
    await Promise.resolve(); await Promise.resolve();
    expect(writes).toEqual(['save_manifest:C:/batch-a/manifest.json']);
    finish(); await Promise.all([a, b]);
    expect(writes).toEqual(['save_manifest:C:/batch-a/manifest.json', 'create_nusuk_batch:C:/batch-a/manifest.json', 'save_manifest:C:/batch-b/manifest.json', 'create_nusuk_batch:C:/batch-b/manifest.json']);
  });
  it('allows a new export after a failed write', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue('export.json');
    const exportFile = createEntryBatchExporter(invoke as any);
    const request = prepareEntryBatch(source()).request!;
    await expect(exportFile(request)).rejects.toThrow('disk full');
    await expect(exportFile(request)).resolves.toBe('export.json');
  });
});
