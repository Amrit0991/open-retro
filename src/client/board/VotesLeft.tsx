export function VotesLeft({ remaining, max }: { remaining: number; max: number }) {
  return (
    <span
      className={`votes-left${remaining === 0 ? ' empty' : ''}`}
      aria-label="votes left"
      title="Votes you can still spend on this board"
    >
      <span className="n">{remaining}</span> of {max} votes left
    </span>
  );
}
