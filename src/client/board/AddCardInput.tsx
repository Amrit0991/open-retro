import { useState } from 'react';

export function AddCardInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="add-card"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed) {
          onAdd(trimmed);
          setText('');
        }
      }}
    >
      <input
        aria-label="add card"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="+  Add a card…"
      />
    </form>
  );
}
