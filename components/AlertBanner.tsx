import { AlertThreshold } from '@/lib/types';

interface Props {
  threshold: AlertThreshold;
  message: string;
  onDismiss: () => void;
}

// Style map — full class names to prevent Tailwind v4 purging
const STYLES: Record<AlertThreshold, { border: string; bg: string; icon: string; iconColor: string }> = {
  80:  {
    border:    'border-warning-line-strong',
    bg:        'bg-warning-soft',
    icon:      '⚠',
    iconColor: 'text-warning-muted',
  },
  100: {
    border:    'border-danger-line-strong',
    bg:        'bg-danger-soft',
    icon:      '!',
    iconColor: 'text-danger-muted',
  },
};

export default function AlertBanner({ threshold, message, onDismiss }: Props) {
  const s = STYLES[threshold];

  return (
    <div
      role="alert"
      data-threshold={threshold}
      className={`flex items-start gap-3 rounded-lg border-l-4 ${s.border} ${s.bg} px-4 py-3`}
    >
      {/* Icon */}
      <span className={`shrink-0 font-bold text-sm mt-0.5 w-4 text-center ${s.iconColor}`}>
        {s.icon}
      </span>

      {/* Message */}
      <p className="flex-1 text-sm text-fg-secondary leading-snug">{message}</p>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="shrink-0 text-fg-disabled hover:text-fg-muted transition-colors text-lg leading-none mt-0.5"
        aria-label="Dismiss alert"
      >
        ×
      </button>
    </div>
  );
}
