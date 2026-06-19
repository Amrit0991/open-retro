import type { CSSProperties } from 'react';
import { Icon, type IconName } from './icons';

export type Tone = 'green' | 'blue' | 'coral' | 'purple' | 'amber' | 'pink' | 'slate';

// The signature colored-glyph chip: a soft-tinted rounded square + an accent icon.
// `tone` sets both background tint and icon color (see .glyph rules in styles.css).
export function Glyph({
  tone,
  icon,
  size = 34,
}: {
  tone: Tone;
  icon: IconName;
  size?: number;
}) {
  return (
    <span className="glyph" data-tone={tone} style={{ '--g-size': `${size}px` } as CSSProperties}>
      <Icon name={icon} size={Math.round(size * 0.52)} />
    </span>
  );
}
