import type { TemplateId, TemplateSnapshot } from './protocol';

export const TEMPLATES: Record<TemplateId, TemplateSnapshot> = {
  three_little_pigs: {
    name: 'Three Little Pigs',
    glyph: { tone: 'coral', icon: 'home' },
    columns: [
      { id: 'straws', title: 'House of Straws', subtitle: 'Things that could easily fall apart', tone: 'amber', icon: 'wind' },
      { id: 'sticks', title: 'House of Sticks', subtitle: 'Things that are working but could be improved', tone: 'green', icon: 'layers' },
      { id: 'bricks', title: 'House of Bricks', subtitle: 'Things that are strong and stable', tone: 'coral', icon: 'home' },
    ],
  },
  sailboat: {
    name: 'Sailboat',
    glyph: { tone: 'blue', icon: 'sail' },
    columns: [
      { id: 'wind', title: 'Wind', subtitle: 'What is pushing us forward', tone: 'blue', icon: 'wind' },
      { id: 'anchors', title: 'Anchors', subtitle: 'What is holding us back', tone: 'slate', icon: 'anchor' },
      { id: 'rocks', title: 'Rocks', subtitle: 'Risks ahead of us', tone: 'purple', icon: 'mountain' },
      { id: 'island', title: 'Island', subtitle: 'Our goals and ideal destination', tone: 'green', icon: 'palm' },
    ],
  },
};
