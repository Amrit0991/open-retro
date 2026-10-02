import { describe, it, expect } from 'vitest';
import { initialBuilder, fromTemplate, templateReducer, toInput } from '../../src/client/templates/reducer';
import type { TemplateSummary } from '../../src/shared/protocol';

describe('templateReducer', () => {
  it('adds, edits, tones, reorders, removes columns immutably', () => {
    let s = initialBuilder(); // starts with 1 empty column
    s = templateReducer(s, { type: 'setName', value: 'Retro' });
    s = templateReducer(s, { type: 'addColumn' });
    expect(s.columns).toHaveLength(2);
    const [k0, k1] = s.columns.map((c) => c.key);
    s = templateReducer(s, { type: 'setField', key: k0, field: 'title', value: 'Good' });
    s = templateReducer(s, { type: 'setTone', key: k0, tone: 'green' });
    s = templateReducer(s, { type: 'setField', key: k1, field: 'title', value: 'Bad' });
    s = templateReducer(s, { type: 'moveColumn', key: k1, dir: -1 });
    expect(s.columns.map((c) => c.title)).toEqual(['Bad', 'Good']);
    s = templateReducer(s, { type: 'removeColumn', key: k0 });
    expect(s.columns.map((c) => c.title)).toEqual(['Bad']);
    expect(toInput(s)).toEqual({ name: 'Retro', columns: [{ title: 'Bad', subtitle: '', tone: 'slate' }] });
  });

  it('does not remove the last column or reorder past the ends', () => {
    let s = initialBuilder();
    const k = s.columns[0].key;
    s = templateReducer(s, { type: 'removeColumn', key: k });
    expect(s.columns).toHaveLength(1); // floor of 1
    s = templateReducer(s, { type: 'moveColumn', key: k, dir: -1 });
    expect(s.columns).toHaveLength(1);
  });

  it('initialBuilder starts with one fresh empty slate column and a blank name', () => {
    const s = initialBuilder();
    expect(s.name).toBe('');
    expect(s.columns).toHaveLength(1);
    expect(s.columns[0]).toMatchObject({ title: '', subtitle: '', tone: 'slate' });
    expect(typeof s.columns[0].key).toBe('string');
    expect(s.columns[0].key.length).toBeGreaterThan(0);
  });

  it('caps addColumn at the column limit (6) as a no-op at the cap', () => {
    let s = initialBuilder();
    for (let i = 0; i < 10; i++) s = templateReducer(s, { type: 'addColumn' });
    expect(s.columns).toHaveLength(6);
    const before = s;
    s = templateReducer(s, { type: 'addColumn' });
    expect(s.columns).toHaveLength(6);
    expect(s).toBe(before); // no-op returns the same state at the cap
  });

  it('moveColumn dir:1 clamps at the last column', () => {
    let s = initialBuilder();
    s = templateReducer(s, { type: 'addColumn' });
    const [, k1] = s.columns.map((c) => c.key);
    const before = s;
    s = templateReducer(s, { type: 'moveColumn', key: k1, dir: 1 });
    expect(s.columns.map((c) => c.key)).toEqual(before.columns.map((c) => c.key));
  });

  it('fromTemplate maps a summary to rows with fresh keys distinct from server ids', () => {
    const summary: TemplateSummary = {
      id: 'tmpl-1',
      name: 'Sailboat',
      glyph: { tone: 'blue', icon: 'sailboat' },
      readOnly: false,
      columns: [
        { id: 'col-a', title: 'Wind', subtitle: 'pushes us', tone: 'green', icon: 'wind' },
        { id: 'col-b', title: 'Anchor', subtitle: 'holds us back', tone: 'coral', icon: 'anchor' },
      ],
    };
    const s = fromTemplate(summary);
    expect(s.name).toBe('Sailboat');
    expect(s.columns.map((c) => ({ title: c.title, subtitle: c.subtitle, tone: c.tone }))).toEqual([
      { title: 'Wind', subtitle: 'pushes us', tone: 'green' },
      { title: 'Anchor', subtitle: 'holds us back', tone: 'coral' },
    ]);
    // keys are fresh client ids, NOT the server column ids
    expect(s.columns.map((c) => c.key)).not.toEqual(['col-a', 'col-b']);
    expect(new Set(s.columns.map((c) => c.key)).size).toBe(2);
  });

  it('does not mutate the input state', () => {
    const s = initialBuilder();
    const snapshot = JSON.stringify(s);
    templateReducer(s, { type: 'setName', value: 'Mutated?' });
    templateReducer(s, { type: 'addColumn' });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('setField on subtitle and setTone update only the targeted column', () => {
    let s = initialBuilder();
    s = templateReducer(s, { type: 'addColumn' });
    const [k0, k1] = s.columns.map((c) => c.key);
    s = templateReducer(s, { type: 'setField', key: k0, field: 'subtitle', value: 'note' });
    s = templateReducer(s, { type: 'setTone', key: k1, tone: 'amber' });
    expect(s.columns[0]).toMatchObject({ subtitle: 'note', tone: 'slate' });
    expect(s.columns[1]).toMatchObject({ subtitle: '', tone: 'amber' });
  });
});
