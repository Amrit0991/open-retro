import type { IconName } from './icons';
import type { Tone } from './Glyph';
import { TEMPLATES } from '../../shared/templates';

export interface GlyphSpec {
  tone: Tone;
  icon: IconName;
}

// Each template + each column gets a themed colored glyph.
const TEMPLATE_GLYPHS: Record<string, GlyphSpec> = {
  three_little_pigs: { tone: 'coral', icon: 'home' },
  sailboat: { tone: 'blue', icon: 'sail' },
};

const COLUMN_GLYPHS: Record<string, GlyphSpec> = {
  // Three Little Pigs
  straws: { tone: 'amber', icon: 'wind' },
  sticks: { tone: 'green', icon: 'layers' },
  bricks: { tone: 'coral', icon: 'home' },
  // Sailboat
  wind: { tone: 'blue', icon: 'wind' },
  anchors: { tone: 'slate', icon: 'anchor' },
  rocks: { tone: 'purple', icon: 'mountain' },
  island: { tone: 'green', icon: 'palm' },
};

export function templateGlyph(template: string): GlyphSpec {
  return TEMPLATE_GLYPHS[template] ?? { tone: 'slate', icon: 'layers' };
}

export function columnGlyph(columnId: string): GlyphSpec {
  return COLUMN_GLYPHS[columnId] ?? { tone: 'slate', icon: 'layers' };
}

// Pretty display name for a template id, falling back to a title-cased slug.
export function templateName(template: string): string {
  const known = (TEMPLATES as Record<string, { name: string }>)[template];
  if (known) return known.name;
  return template
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
