export interface WorkflowArtwork {
  src: string;
  alt: string;
}

/** Full panels keep the activity and person together instead of cropping to a face. */
export const workflowArtwork = {
  welcome: {
    src: '/workflow/hd/welcome.png',
    alt: 'Sambutan EntryMate dengan operator di depan laptop.',
  },
  importPrepare: {
    src: '/workflow/hd/import-prepare.png',
    alt: 'Import dan Prepare: menyiapkan berkas passport sebelum pemindaian.',
  },
  prepare: {
    src: '/workflow/hd/prepare.png',
    alt: 'Prepare: memotong dan memutar foto passport sebelum pemindaian.',
  },
  scan: {
    src: '/workflow/hd/scan.png',
    alt: 'Scan: membaca informasi passport dengan OCR.',
  },
  review: {
    src: '/workflow/hd/review.png',
    alt: 'Review: memeriksa dan menyesuaikan data passport.',
  },
  export: {
    src: '/workflow/hd/export.png',
    alt: 'Export: file JSON passport berhasil dibuat.',
  },
  entry: {
    src: '/workflow/hd/entry.png',
    alt: 'Entry: menjalankan pengisian formulir Nusuk.',
  },
} satisfies Record<string, WorkflowArtwork>;
