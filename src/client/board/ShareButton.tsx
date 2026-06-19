import { useState } from 'react';
import { Icon } from '../ui/icons';

export function ShareButton({ boardId }: { boardId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const url = `${location.origin}/b/${boardId}`;
    // navigator.clipboard is unavailable in non-secure contexts / some test envs.
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };
  return (
    <button type="button" className="btn" onClick={copy}>
      <span className="icon-c">
        <Icon name={copied ? 'check' : 'share'} size={16} />
      </span>
      {copied ? 'Copied' : 'Share'}
    </button>
  );
}
