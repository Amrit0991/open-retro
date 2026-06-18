export function ShareButton({ boardId }: { boardId: string }) {
  const copy = () => {
    const url = `${location.origin}/b/${boardId}`;
    // navigator.clipboard is unavailable in non-secure contexts / some test envs.
    navigator.clipboard?.writeText(url).catch(() => {});
  };
  return (
    <button type="button" onClick={copy}>
      Share
    </button>
  );
}
