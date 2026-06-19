import { useReducer, useState } from 'react';
import { DEFAULT_COLUMN_ICON, LIMITS } from '../../shared/protocol';
import type { Tone, TemplateColumnInput, TemplateSummary } from '../../shared/protocol';
import { Glyph } from '../ui/Glyph';
import {
  fromTemplate,
  initialBuilder,
  templateReducer,
  toInput,
} from './reducer';

// The 7 tones a column can wear, in swatch order.
const TONES: readonly Tone[] = ['green', 'blue', 'coral', 'purple', 'amber', 'pink', 'slate'];

export function TemplateBuilder({
  initial,
  onSave,
  onClose,
}: {
  initial?: TemplateSummary;
  onSave: (input: { name: string; columns: TemplateColumnInput[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(
    templateReducer,
    initial,
    (t) => (t ? fromTemplate(t) : initialBuilder()),
  );
  const [error, setError] = useState(false);

  const atCap = state.columns.length >= LIMITS.templateColumnsMax;
  const single = state.columns.length <= 1;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={initial ? 'Edit template' : 'New template'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{initial ? 'Edit template' : 'New template'}</h2>
        <p className="modal-sub">Name it, then shape the columns — tone, title, and an optional subtitle.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(false);
            try {
              await onSave(toInput(state));
              onClose();
            } catch {
              setError(true); // keep the modal open so the user can retry
            }
          }}
        >
          <div className="field">
            <label htmlFor="t-name">Template name</label>
            <input
              id="t-name"
              className="input"
              placeholder="Quick Retro"
              value={state.name}
              onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <span className="field-label">Columns</span>
            {state.columns.map((col, i) => (
              <div className="col-row" key={col.key}>
                <div className="swatches" role="group" aria-label="column tone">
                  {TONES.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      className="swatch"
                      aria-label={`tone ${tone}`}
                      aria-pressed={col.tone === tone}
                      onClick={() => dispatch({ type: 'setTone', key: col.key, tone })}
                    >
                      <Glyph tone={tone} icon={DEFAULT_COLUMN_ICON} size={26} />
                    </button>
                  ))}
                </div>
                <input
                  className="input"
                  aria-label="column title"
                  placeholder="Keep"
                  value={col.title}
                  onChange={(e) =>
                    dispatch({ type: 'setField', key: col.key, field: 'title', value: e.target.value })
                  }
                />
                <input
                  className="input"
                  aria-label="column subtitle"
                  placeholder="What's going well?"
                  value={col.subtitle}
                  onChange={(e) =>
                    dispatch({ type: 'setField', key: col.key, field: 'subtitle', value: e.target.value })
                  }
                />
                <div className="col-tools">
                  <button
                    type="button"
                    className="btn icon-btn"
                    aria-label="move column up"
                    disabled={i === 0}
                    onClick={() => dispatch({ type: 'moveColumn', key: col.key, dir: -1 })}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="btn icon-btn"
                    aria-label="move column down"
                    disabled={i === state.columns.length - 1}
                    onClick={() => dispatch({ type: 'moveColumn', key: col.key, dir: 1 })}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="btn icon-btn"
                    aria-label="remove column"
                    disabled={single}
                    onClick={() => dispatch({ type: 'removeColumn', key: col.key })}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              disabled={atCap}
              onClick={() => dispatch({ type: 'addColumn' })}
            >
              Add column
            </button>
          </div>

          {error && (
            <p className="alert" role="alert">
              Couldn't save the template. Please try again.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save template
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
