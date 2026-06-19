import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { LoginPage } from '../../src/client/auth/LoginPage';
import { CreateBoardModal } from '../../src/client/boards/CreateBoardModal';
import { BoardListPage } from '../../src/client/boards/BoardList';
import { api } from '../../src/client/api';
import { computeNeighbors, resolveMove } from '../../src/client/board/dnd';
import { sortedOrder } from '../../src/client/board/SortToggle';

// happy-dom + RTL don't auto-unmount between tests in this project; clean up so
// rendered DOM (e.g. a still-open modal) doesn't leak duplicate elements.
afterEach(cleanup);

it('computes neighbors for a drop position', () => {
  const ids = ['a', 'b', 'c'];
  expect(computeNeighbors(ids, 2)).toEqual({ beforeId: 'b', afterId: 'c' }); // dropping before index 2
  expect(computeNeighbors(ids, 0)).toEqual({ beforeId: null, afterId: 'a' }); // head
  expect(computeNeighbors(ids, 3)).toEqual({ beforeId: 'c', afterId: null }); // tail
});

describe('resolveMove (drop → moveCard args)', () => {
  // order is the FULL board order (dragged card still present in its source col).
  // overIndex is dnd-kit's index into the FULL destination list (or null = empty/tail droppable).
  const order = { src: ['a', 'b', 'c'], dst: ['x', 'y', 'z'], empty: [] as string[] };

  it('cross-column drop at the head', () => {
    expect(resolveMove(order, 'a', 'dst', 0)).toEqual({
      toColumnId: 'dst',
      beforeId: null,
      afterId: 'x',
    });
  });

  it('cross-column drop in the middle', () => {
    expect(resolveMove(order, 'a', 'dst', 1)).toEqual({
      toColumnId: 'dst',
      beforeId: 'x',
      afterId: 'y',
    });
  });

  it('cross-column drop at the tail (overIndex past last card)', () => {
    expect(resolveMove(order, 'a', 'dst', 3)).toEqual({
      toColumnId: 'dst',
      beforeId: 'z',
      afterId: null,
    });
  });

  it('same-column move DOWN reconciles the off-by-one (a → between b and c)', () => {
    // dnd-kit reports overIndex=2 (the slot c occupies in the FULL list). With the
    // dragged 'a' removed the without-list is [b, c]; we want { before:b, after:c }.
    expect(resolveMove(order, 'a', 'src', 2)).toEqual({
      toColumnId: 'src',
      beforeId: 'b',
      afterId: 'c',
    });
  });

  it('same-column move DOWN to the tail (a → after c)', () => {
    expect(resolveMove(order, 'a', 'src', 3)).toEqual({
      toColumnId: 'src',
      beforeId: 'c',
      afterId: null,
    });
  });

  it('same-column move UP does not shift (c → before b)', () => {
    // dnd-kit reports overIndex=1 (b's slot). without-list [a, b]; target index 1 → { before:a, after:b }.
    expect(resolveMove(order, 'c', 'src', 1)).toEqual({
      toColumnId: 'src',
      beforeId: 'a',
      afterId: 'b',
    });
  });

  it('drop into an empty column (overIndex null → tail of empty)', () => {
    expect(resolveMove(order, 'a', 'empty', null)).toEqual({
      toColumnId: 'empty',
      beforeId: null,
      afterId: null,
    });
  });

  it('drop into an unknown / missing column treats it as empty', () => {
    expect(resolveMove(order, 'a', 'nope', null)).toEqual({
      toColumnId: 'nope',
      beforeId: null,
      afterId: null,
    });
  });
});

it('sorts a column by votes desc when active, preserves position order when off', () => {
  const cards: any = { a: { votes: 1, position: 1 }, b: { votes: 3, position: 2 }, c: { votes: 2, position: 3 } };
  const order = { col: ['a', 'b', 'c'] };
  expect(sortedOrder(order, cards, true).col).toEqual(['b', 'c', 'a']);
  expect(sortedOrder(order, cards, false).col).toEqual(['a', 'b', 'c']);
});

it('submits email and shows the check-inbox confirmation', async () => {
  const requestMagicLink = vi.fn().mockResolvedValue(undefined);
  render(<LoginPage requestMagicLink={requestMagicLink} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  expect(requestMagicLink).toHaveBeenCalledWith('a@b.com');
  expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
});

it('creates a board with chosen template and votes', async () => {
  const onCreate = vi.fn().mockResolvedValue({ id: 'b1' });
  render(<CreateBoardModal onCreate={onCreate} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'Sprint 13');
  await userEvent.selectOptions(screen.getByLabelText(/template/i), 'sailboat');
  await userEvent.clear(screen.getByLabelText(/max votes/i));
  await userEvent.type(screen.getByLabelText(/max votes/i), '5');
  await userEvent.click(screen.getByRole('button', { name: /create/i }));
  expect(onCreate).toHaveBeenCalledWith({ name: 'Sprint 13', template: 'sailboat', maxVotes: 5 });
});

it('keeps the modal open and shows an error when create rejects', async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error('400'));
  const onClose = vi.fn();
  const { getByRole } = render(<CreateBoardModal onCreate={onCreate} onClose={onClose} />);
  const dialog = within(getByRole('dialog'));
  await userEvent.type(dialog.getByLabelText(/name/i), 'Sprint 13');
  await userEvent.click(dialog.getByRole('button', { name: /create/i }));
  expect(await dialog.findByText(/couldn't create/i)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled(); // modal stays open
  expect(dialog.getByRole('button', { name: /create/i })).toBeInTheDocument();
});

it('shows an error message when the board list fails to load', async () => {
  const spy = vi.spyOn(api, 'listBoards').mockRejectedValue(new Error('401'));
  render(
    <MemoryRouter>
      <BoardListPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/couldn't load your boards/i)).toBeInTheDocument();
  spy.mockRestore();
});
