import { buildManifestForEntryExport, validateCompanionsForExport } from './export';
import { memberReviewStatus } from './members';

export interface EntryBatchSource {
  manifest: any;
  manifestPath: string;
  selectedIds: Set<string>;
  reviewedMemberIds: Set<string>;
  isScanning: boolean;
}

export interface EntryBatchRequest {
  signature: string;
  manifestPath: string;
  manifestToSave: any;
  manifestData: any;
  selectedIds: string[];
  memberCount: number;
}

export function prepareEntryBatch(source: EntryBatchSource): { request: EntryBatchRequest | null; error: string } {
  if (!source.manifestPath || !source.manifest?.members?.length) return { request: null, error: 'Pilih folder dan selesaikan scan passport terlebih dahulu.' };
  if (source.isScanning) return { request: null, error: 'Tunggu proses scan selesai.' };
  const manifest = JSON.parse(JSON.stringify(source.manifest));
  const reviewable = manifest.members.filter((member: any) => memberReviewStatus(member) !== 'ERROR');
  const unreviewed = reviewable.filter((member: any) => !member.reviewConfirmed && !source.reviewedMemberIds.has(member.id));
  if (unreviewed.length) return { request: null, error: `${unreviewed.length} passport masih perlu diperiksa di Review.` };
  for (const member of reviewable) {
    member.reviewConfirmed = true;
    if (source.reviewedMemberIds.has(member.id) && member.reviewStatus === 'NEEDS_REVIEW') member.reviewStatus = 'VALID';
  }
  const validation = validateCompanionsForExport(manifest, source.selectedIds);
  if (!validation.ok) return { request: null, error: validation.message };
  const exported = buildManifestForEntryExport(manifest, source.selectedIds);
  const selectedIds = Array.from(exported.selectedIds).sort();
  const ready = exported.manifest.members.filter((member: any) => selectedIds.includes(member.id) && memberReviewStatus(member) === 'VALID' && member.reviewConfirmed);
  if (!ready.length) return { request: null, error: 'Belum ada passport yang siap diekspor. Periksa data dan pilihan jamaah di Review.' };
  return {
    error: '',
    request: {
      signature: JSON.stringify([source.manifestPath, selectedIds, manifest]),
      manifestPath: source.manifestPath,
      manifestToSave: manifest,
      manifestData: exported.manifest,
      selectedIds,
      memberCount: ready.length,
    },
  };
}

type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

// Serialize writes so a slower export can never overwrite a newer batch at the same path.
export function createEntryBatchExporter(invoke: Invoke) {
  let writes: Promise<unknown> = Promise.resolve();
  const pending = new Map<string, Promise<string>>();
  return (request: EntryBatchRequest): Promise<string> => {
    const existing = pending.get(request.signature);
    if (existing) return existing;
    const result = writes.catch(() => {}).then(async () => {
      await invoke('save_manifest', { manifestPath: request.manifestPath, manifestData: request.manifestToSave });
      return invoke<string>('create_nusuk_batch', {
        manifestPath: request.manifestPath,
        manifestData: request.manifestData,
        selectedIds: request.selectedIds,
      });
    });
    writes = result;
    pending.set(request.signature, result);
    void result.finally(() => pending.delete(request.signature)).catch(() => {});
    return result;
  };
}
