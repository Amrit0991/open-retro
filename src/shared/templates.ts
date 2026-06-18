import type { TemplateId, ColumnDef } from './protocol';

export const TEMPLATES: Record<TemplateId, { name: string; columns: ColumnDef[] }> = {
  three_little_pigs: {
    name: 'Three Little Pigs',
    columns: [
      { id: 'straws', title: 'House of Straws', subtitle: 'Things that could easily fall apart' },
      { id: 'sticks', title: 'House of Sticks', subtitle: 'Things that are working but could be improved' },
      { id: 'bricks', title: 'House of Bricks', subtitle: 'Things that are strong and stable' },
    ],
  },
  sailboat: {
    name: 'Sailboat',
    columns: [
      { id: 'wind', title: 'Wind', subtitle: 'What is pushing us forward' },
      { id: 'anchors', title: 'Anchors', subtitle: 'What is holding us back' },
      { id: 'rocks', title: 'Rocks', subtitle: 'Risks ahead of us' },
      { id: 'island', title: 'Island', subtitle: 'Our goals and ideal destination' },
    ],
  },
};
