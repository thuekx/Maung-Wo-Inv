/** Status Purchase Request: label & warna lencana. */
export const PR_STATUS: Record<string, { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' }> = {
  DRAFT: { label: 'Draft', tone: 'slate' }, SUBMITTED: { label: 'Diajukan ke GA', tone: 'amber' }, ISSUED: { label: 'Diterbitkan – menunggu persetujuan', tone: 'blue' },
  APPROVED: { label: 'Disetujui – menunggu PO', tone: 'blue' }, PO_ENTERED: { label: 'PO tercatat', tone: 'green' }, CLOSED: { label: 'Selesai', tone: 'green' },
  REJECTED: { label: 'Ditolak', tone: 'red' }, CANCELLED: { label: 'Dibatalkan', tone: 'red' },
};

