import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Glyph } from '../ui/Glyph';
import { Icon } from '../ui/icons';
import { TemplateBuilder } from './TemplateBuilder';
import type { TemplateColumnInput, TemplateSummary } from '../../shared/protocol';

interface TemplateList {
  builtins: TemplateSummary[];
  custom: TemplateSummary[];
}

// `null` = builder closed; `{ initial }` = open (initial undefined → create).
type BuilderState = { initial?: TemplateSummary } | null;

export function TemplatesPage() {
  const [list, setList] = useState<TemplateList>({ builtins: [], custom: [] });
  const [loadError, setLoadError] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>(null);

  const refetch = useCallback(async () => {
    try {
      const next = (await api.listTemplates()) as TemplateList;
      setList(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const save = async (input: { name: string; columns: TemplateColumnInput[] }) => {
    const editing = builder?.initial;
    if (editing) await api.updateTemplate(editing.id, input);
    else await api.createTemplate(input);
    await refetch();
  };

  const remove = async (id: string) => {
    await api.deleteTemplate(id);
    await refetch();
  };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <Glyph tone="green" icon="layers" size={28} />
          <span className="wordmark">
            <b>open</b>
            <span>-retro</span>
          </span>
        </Link>
        <div className="spacer" />
        <Link to="/" className="btn">
          Boards
        </Link>
        <button className="btn btn-primary" onClick={() => setBuilder({})}>
          <span className="icon-c">
            <Icon name="plus" size={16} />
          </span>
          New template
        </button>
      </header>

      <div className="page">
        <div className="page-head">
          <div>
            <h1>Templates</h1>
            <div className="sub">Defaults are read-only — build your own to reuse.</div>
          </div>
        </div>

        {loadError && (
          <p className="alert" role="alert">
            Couldn't load templates. Refresh to try again.
          </p>
        )}

        <section className="tmpl-section">
          <h2 className="tmpl-section-title">Defaults</h2>
          <div className="tmpl-grid">
            {list.builtins.map((t) => (
              <div className="tmpl-row" key={t.id}>
                <Glyph tone={t.glyph.tone} icon={t.glyph.icon} size={34} />
                <span className="tmpl-name">{t.name}</span>
                <span className="badge">Default</span>
              </div>
            ))}
          </div>
        </section>

        <section className="tmpl-section">
          <h2 className="tmpl-section-title">Your templates</h2>
          {list.custom.length === 0 ? (
            <button
              className="add-card-cta"
              onClick={() => setBuilder({})}
              style={{ width: 320, minHeight: 180 }}
            >
              <Glyph tone="green" icon="plus" size={40} />
              New template
            </button>
          ) : (
            <div className="tmpl-grid">
              {list.custom.map((t) => (
                <div className="tmpl-row" key={t.id}>
                  <Glyph tone={t.glyph.tone} icon={t.glyph.icon} size={34} />
                  <span className="tmpl-name">{t.name}</span>
                  <div className="tmpl-row-tools">
                    <button className="btn" onClick={() => setBuilder({ initial: t })}>
                      Edit
                    </button>
                    <button
                      className="btn"
                      aria-label={`delete ${t.name}`}
                      onClick={() => void remove(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {builder && (
        <TemplateBuilder
          initial={builder.initial}
          onSave={save}
          onClose={() => setBuilder(null)}
        />
      )}
    </>
  );
}
