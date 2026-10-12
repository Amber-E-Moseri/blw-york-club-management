import React from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

export interface TagProps {
  variant?: 'colored' | 'light';
  color?: string;
  children: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  icon?: React.ReactNode;
}

/** Returns a contrasting text color (black or white) for a hex background. */
function contrastColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // WCAG luminance formula
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#111111' : '#ffffff';
}

/** Lightens a hex color by mixing with white. */
function lightenHex(hex: string, amount = 0.85): string {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.slice(0, 2), 16) + (255 - parseInt(h.slice(0, 2), 16)) * amount);
  const g = Math.round(parseInt(h.slice(2, 4), 16) + (255 - parseInt(h.slice(2, 4), 16)) * amount);
  const b = Math.round(parseInt(h.slice(4, 6), 16) + (255 - parseInt(h.slice(4, 6), 16)) * amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Inline label/tag for categorization. Supports custom colors, icons, and removal.
 *
 * @example
 * <Tag variant="light" color="#E31837">Interested</Tag>
 *
 * <Tag variant="colored" removable onRemove={() => handleRemove()}>Prayer Request</Tag>
 *
 * <Tag icon={<CheckIcon />}>Contacted</Tag>
 *
 * <Tag color="#4CAF50" variant="light">Followed Up</Tag>
 */
export const Tag: React.FC<TagProps> = ({
  variant = 'light',
  color = '#E31837',
  children,
  removable = false,
  onRemove,
  className,
  icon,
}) => {
  const inlineStyle: React.CSSProperties =
    variant === 'colored'
      ? { backgroundColor: color, color: contrastColor(color) }
      : { backgroundColor: lightenHex(color), color: color };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold',
        'select-none whitespace-nowrap',
        className
      )}
      style={inlineStyle}
    >
      {icon && <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span>}
      {children}
      {removable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          aria-label="Remove tag"
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full opacity-60 hover:opacity-100 transition-opacity ml-0.5 shrink-0"
          style={{ color: 'inherit' }}
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};
