import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import { LoginPage } from '../../src/client/auth/LoginPage';
import { CreateBoardModal } from '../../src/client/boards/CreateBoardModal';
import { computeNeighbors } from '../../src/client/board/dnd';

it('computes neighbors for a drop position', () => {
  const ids = ['a', 'b', 'c'];
  expect(computeNeighbors(ids, 2)).toEqual({ beforeId: 'b', afterId: 'c' }); // dropping before index 2
  expect(computeNeighbors(ids, 0)).toEqual({ beforeId: null, afterId: 'a' }); // head
  expect(computeNeighbors(ids, 3)).toEqual({ beforeId: 'c', afterId: null }); // tail
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
