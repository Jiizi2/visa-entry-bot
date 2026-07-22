import AppIcon from '../../components/ui/AppIcon';

interface EntrySummaryCardsProps {
  exportPreview: any;
}

export default function EntrySummaryCards({ exportPreview }: EntrySummaryCardsProps) {
  if (!exportPreview) return null;

  const total = exportPreview.review.total + exportPreview.failedMembers.length;
  const ready = exportPreview.readyMembers.length;
  const excluded = exportPreview.failedMembers.length + exportPreview.skippedMembers.length;
  const completion = total > 0 ? Math.min((ready / total) * 100, 100) : 0;

  return (
    <div className="entry-readiness-overview" aria-label={`${ready} dari ${total} passport siap dikirim`}>
      <div className="entry-readiness-overview__value">
        <span className="entry-readiness-overview__icon"><AppIcon name="check" size={18} /></span>
        <strong>{ready}<small>/{total}</small></strong>
        <span>passport siap</span>
      </div>
      <div className="entry-readiness-overview__progress" aria-hidden="true">
        <span style={{ width: `${completion}%` }} />
      </div>
      <div className="entry-readiness-overview__meta">
        <span>{exportPreview.review.remaining === 0 ? 'Review selesai' : `${exportPreview.review.remaining} belum direview`}</span>
        {excluded > 0 && <span>{excluded} tidak disertakan</span>}
      </div>
    </div>
  );
}
