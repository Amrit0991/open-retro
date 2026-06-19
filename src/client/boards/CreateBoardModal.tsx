import { useState } from 'react';
import { TEMPLATES } from '../../shared/templates';
import type { TemplateId } from '../../shared/protocol';
import { Glyph } from '../ui/Glyph';
import { templateGlyph } from '../ui/glyphs';

export function CreateBoardModal({
  onCreate,
  onClose,
}: {
  onCreate: (b: { name: string; template: TemplateId; maxVotes: number }) => Promise<{ id: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TemplateId>('three_little_pigs');
  const [maxVotes, setMaxVotes] = useState(6);
  const [error, setError] = useState(false);
  const g = templateGlyph(template);

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
                onChange={(e) => setTemplate(e.target.value as TemplateId)}
              >
                {Object.entries(TEMPLATES).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.name} · {t.columns.length} columns
                  </option>
                ))}
              </select>
            </div>
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
