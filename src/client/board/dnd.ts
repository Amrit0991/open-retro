// Neighbors at the target slot in the destination column's current order
// (excluding the dragged card). Head drop -> { beforeId: null, afterId: first };
// tail drop -> { beforeId: last, afterId: null }; otherwise the straddling pair.
export function computeNeighbors(
  orderedIdsWithoutDragged: string[],
  targetIndex: number,
): { beforeId: string | null; afterId: string | null } {
  const before = targetIndex - 1 >= 0 ? orderedIdsWithoutDragged[targetIndex - 1] ?? null : null;
  const after = orderedIdsWithoutDragged[targetIndex] ?? null;
  return { beforeId: before, afterId: after };
}
