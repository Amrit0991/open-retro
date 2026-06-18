import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../src/shared/templates';

describe('templates', () => {
  it('three_little_pigs has 3 columns with stable ids', () => {
    expect(TEMPLATES.three_little_pigs.columns.map(c => c.id)).toEqual(['straws', 'sticks', 'bricks']);
  });
  it('sailboat has 4 columns', () => {
    expect(TEMPLATES.sailboat.columns).toHaveLength(4);
    expect(TEMPLATES.sailboat.columns[0].id).toBe('wind');
  });
});
