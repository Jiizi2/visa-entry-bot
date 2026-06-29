import { describe, it, expect } from 'vitest';
import {
  isMemberReadyForEntry,
  isMemberReviewConfirmed,
  isMemberReadyForJson,
  defaultSelectedIds,
  effectiveSelectedIdsForExport,
  buildManifestForEntryExport,
} from './export';

describe('export utilities', () => {
  describe('isMemberReadyForEntry', () => {
    it('should return true if reviewStatus is VALID', () => {
      const member = { reviewStatus: 'VALID' };
      expect(isMemberReadyForEntry(member)).toBe(true);
    });

    it('should return false if reviewStatus is not VALID', () => {
      const member = { reviewStatus: 'NEEDS_REVIEW' };
      expect(isMemberReadyForEntry(member)).toBe(false);
    });
  });

  describe('isMemberReviewConfirmed', () => {
    it('should return true if reviewConfirmed is true', () => {
      const member = { id: 'm1', reviewConfirmed: true };
      expect(isMemberReviewConfirmed(member)).toBe(true);
    });

    it('should return true if id is in reviewedMemberIds set', () => {
      const member = { id: 'm1', reviewConfirmed: false };
      const reviewedSet = new Set(['m1', 'm2']);
      expect(isMemberReviewConfirmed(member, reviewedSet)).toBe(true);
    });

    it('should return false if neither is true', () => {
      const member = { id: 'm1', reviewConfirmed: false };
      const reviewedSet = new Set(['m2']);
      expect(isMemberReviewConfirmed(member, reviewedSet)).toBe(false);
    });
  });

  describe('isMemberReadyForJson', () => {
    it('should return true if member is valid and review is confirmed', () => {
      const member = { id: 'm1', reviewStatus: 'VALID', reviewConfirmed: true };
      expect(isMemberReadyForJson(member)).toBe(true);
    });

    it('should return false if member is invalid', () => {
      const member = { id: 'm1', reviewStatus: 'ERROR', reviewConfirmed: true };
      expect(isMemberReadyForJson(member)).toBe(false);
    });
  });

  describe('defaultSelectedIds', () => {
    it('should return empty array if manifest is empty or invalid', () => {
      expect(defaultSelectedIds(null)).toEqual([]);
      expect(defaultSelectedIds({})).toEqual([]);
    });

    it('should return IDs of members that are ready for entry', () => {
      const manifest = {
        members: [
          { id: 'm1', reviewStatus: 'VALID' },
          { id: 'm2', reviewStatus: 'ERROR' },
          { id: 'm3', reviewStatus: 'VALID' },
        ]
      };
      expect(defaultSelectedIds(manifest)).toEqual(['m1', 'm3']);
    });
  });

  describe('effectiveSelectedIdsForExport', () => {
    it('should return default selected IDs if selectedIds is empty', () => {
      const manifest = {
        members: [
          { id: 'm1', reviewStatus: 'VALID' },
          { id: 'm2', reviewStatus: 'ERROR' },
        ]
      };
      const result = effectiveSelectedIdsForExport(manifest, new Set());
      expect(Array.from(result)).toEqual(['m1']);
    });

    it('should include selectedIds and their companionId', () => {
      const manifest = {
        members: [
          { id: 'm1', reviewStatus: 'VALID', companionMemberId: 'm2' },
          { id: 'm2', reviewStatus: 'VALID' },
          { id: 'm3', reviewStatus: 'VALID' },
        ]
      };
      const selected = new Set(['m1']);
      const result = effectiveSelectedIdsForExport(manifest, selected);
      expect(result.has('m1')).toBe(true);
      expect(result.has('m2')).toBe(true); // Auto-included companion
      expect(result.has('m3')).toBe(false);
    });
  });
});
