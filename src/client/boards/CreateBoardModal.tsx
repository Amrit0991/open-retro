import { useState } from 'react';
import { TEMPLATES } from '../../shared/templates';
import type { TemplateId } from '../../shared/protocol';

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

  return (
    <div role="dialog" aria-label="Create board">
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
        <label htmlFor="b-name">Name</label>
        <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="b-tpl">Template</label>
        <select
          id="b-tpl"
          value={template}
          onChange={(e) => setTemplate(e.target.value as TemplateId)}
        >
          {Object.entries(TEMPLATES).map(([id, t]) => (
            <option key={id} value={id}>
              {t.name}
            </option>
          ))}
        </select>
        <label htmlFor="b-votes">Max votes</label>
        <input
          id="b-votes"
          type="number"
          min={1}
          max={99}
          value={maxVotes}
          onChange={(e) => setMaxVotes(Number(e.target.value))}
        />
        {error && <p role="alert">Couldn't create the board. Please try again.</p>}
        <button type="submit">Create</button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
