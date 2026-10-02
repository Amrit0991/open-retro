import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TEMPLATES } from '../../shared/templates';
import type { TemplateSummary, Tone } from '../../shared/protocol';
import { Glyph } from '../ui/Glyph';
import { api } from '../api';

// A selectable template in the dropdown — a built-in slug or a custom uuid.
interface TemplateOption {
  id: string;
  name: string;
  glyph: { tone: Tone; icon: string };
}

// Built-ins render synchronously so the select is usable before any fetch resolves.
const BUILTIN_OPTIONS: TemplateOption[] = Object.entries(TEMPLATES).map(([id, t]) => ({
  id,
  name: `${t.name} · ${t.columns.length} columns`,
  glyph: t.glyph,
}));

export function CreateBoardModal({
  onCreate,
  onClose,
}: {
  onCreate: (b: { name: string; template: string; maxVotes: number }) => Promise<{ id: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('three_little_pigs');
  const [maxVotes, setMaxVotes] = useState(6);
  const [error, setError] = useState(false);
  const [custom, setCustom] = useState<TemplateOption[]>([]);

  useEffect(() => {
    let active = true;
    api
      .listTemplates()
      .then((r) => {
        if (!active) return;
        const { custom: summaries = [] } = (r ?? {}) as { custom?: TemplateSummary[] };
        setCustom(summaries.map((t) => ({ id: t.id, name: t.name, glyph: t.glyph })));
      })
      .catch(() => {}); // a rejected/absent fetch leaves the built-ins intact
    return () => {
      active = false;
    };
  }, []);

  // Built-ins first, then custom; dedupe by id (built-ins win).
  const options = useMemo<TemplateOption[]>(() => {
    const seen = new Set(BUILTIN_OPTIONS.map((o) => o.id));
    const merged = [...BUILTIN_OPTIONS];
    for (const o of custom) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      merged.push(o);
    }
    return merged;
  }, [custom]);

  const selected = options.find((o) => o.id === template) ?? BUILTIN_OPTIONS[0];
  const g = selected.glyph;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Create board"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>New retro board</h2>
        <p className="modal-sub">Pick a template and a vote budget — you can change the max anytime.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(false);
            try {
              await onCreate({ name, template, maxVotes });
              onClose();
            } catch {
              setError(true); // keep the modal open so the user can retry
            }
          }}
        >
          <div className="field">
            <label htmlFor="b-name">Name</label>
            <input
              id="b-name"
              className="input"
              placeholder="Sprint 12 retro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="b-tpl">Template</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Glyph tone={g.tone} icon={g.icon} size={44} />
              <select
                id="b-tpl"
                className="select"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <Link to="/templates" className="link-sub">
              Manage templates
            </Link>
          </div>

          <div className="field">
            <label htmlFor="b-votes">Max votes per person</label>
            <input
              id="b-votes"
              className="input input-num"
              type="number"
              min={1}
              max={99}
              value={maxVotes}
              onChange={(e) => setMaxVotes(Number(e.target.value))}
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              Couldn't create the board. Please try again.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
