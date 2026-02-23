import { AlertThreshold } from '@/lib/types';
import AlertBanner from './AlertBanner';

export interface ActiveAlert {
  key: string;           // "{categoryId}-{periodKey}-{threshold}" — unique per alert instance
  threshold: AlertThreshold;
  message: string;
}

interface Props {
  alerts: ActiveAlert[];
  onDismiss: (key: string) => void;
}

export default function AlertPanel({ alerts, onDismiss }: Props) {
  if (alerts.length === 0) return null;

  // Show most severe (100%) alerts first, then 80%
  const sorted = [...alerts].sort((a, b) => b.threshold - a.threshold);

  return (
    <div className="space-y-2" role="region" aria-label="Budget alerts">
      {sorted.map(alert => (
        <AlertBanner
          key={alert.key}
          threshold={alert.threshold}
          message={alert.message}
          onDismiss={() => onDismiss(alert.key)}
        />
      ))}
    </div>
  );
}
