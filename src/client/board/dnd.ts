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

// Maps a dnd-kit drop event onto moveCard() args. Pure & unit-tested — the riskiest
// reordering logic in the app lives here, not buried in onDragEnd.
//
// Inputs:
//   order        — the FULL current board order (the dragged card is still in its source column).
//   activeCardId — the dragged card's id.
//   overColumnId — the destination column id (from the over target's data.current.columnId).
//   overIndex    — dnd-kit's index into the FULL destination list, or null when the drop
//                  landed on a column-level droppable (empty column / below the last card) → tail.
//
// Off-by-one reconciliation: dnd-kit reports indices into the full list, but computeNeighbors
// wants an index into the destination list with the dragged card REMOVED. For a same-column
// move, removing the dragged card shifts every slot after its original position left by one.
// So when the card moves DOWN within its own column (target slot is past its original index),
// we decrement the reported index by one. Cross-column moves and upward moves need no shift.
export function resolveMove(
  order: Record<string, string[]>,
  activeCardId: string,
  overColumnId: string,
  overIndex: number | null,
): { toColumnId: string; beforeId: string | null; afterId: string | null } {
  const destFull = order[overColumnId] ?? [];
  const without = destFull.filter((id) => id !== activeCardId);

  // null = dropped on the column droppable (empty column or past the last card) → append to tail.
  const fullIndex = overIndex ?? destFull.length;

  const sourceColumnId = Object.keys(order).find((colId) => (order[colId] ?? []).includes(activeCardId));
  const sameColumn = sourceColumnId === overColumnId;
  const fromIndex = sameColumn ? destFull.indexOf(activeCardId) : -1;

  // Downward same-column move: the dragged card's removal shifts later slots left by one.
  const targetIndex = sameColumn && fromIndex !== -1 && fullIndex > fromIndex ? fullIndex - 1 : fullIndex;

  const { beforeId, afterId } = computeNeighbors(without, targetIndex);
  return { toColumnId: overColumnId, beforeId, afterId };
}
