import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Card } from '../../src/client/board/Card';
import { VotesLeft } from '../../src/client/board/VotesLeft';
import { toneForUser } from '../../src/client/ui/tone';
import type { Card as CardT } from '../../src/shared/protocol';

afterEach(cleanup);

const CARD: CardT = {
  id: 'c1', columnId: 'wind', text: 'old text', authorId: 'u1', authorName: 'Ann',
  position: 1024, createdAt: 0, votes: 2,
};

// Same activation distance as BoardView, so clicks on card buttons aren't drags.
function Board({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  return (
    <DndContext sensors={sensors}>
      <SortableContext items={['c1']}>{children}</SortableContext>
    </DndContext>
  );
}

function renderCard(props: Partial<Parameters<typeof Card>[0]> = {}) {
  const handlers = { onVote: vi.fn(), onUnvote: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn() };
  render(
    <Board>
      <Card card={CARD} columnId="wind" index={0} mine={0} canModify canVote {...handlers} {...props} />
    </Board>,
  );
  return handlers;
}

describe('toneForUser', () => {
  it('is stable per user and spreads users across tones', () => {
    expect(toneForUser('u1')).toBe(toneForUser('u1'));
    const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(toneForUser));
    expect(tones.size).toBeGreaterThan(2);
  });
});

describe('VotesLeft', () => {
  it('shows remaining of max', () => {
    render(<VotesLeft remaining={2} max={5} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('votes left')).toHaveTextContent('2 of 5 votes left');
  });
});

describe('Card', () => {
  it('colors the avatar by author', () => {
    renderCard();
    expect(screen.getByText('A')).toHaveAttribute('data-tone', toneForUser('u1'));
  });

  it('edits own card: Enter saves trimmed text', async () => {
    const h = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'edit' }));
    const box = screen.getByRole('textbox', { name: 'edit card' });
    await userEvent.clear(box);
    await userEvent.type(box, '  new text {Enter}');
    expect(h.onEdit).toHaveBeenCalledWith('new text');
    expect(screen.queryByRole('textbox', { name: 'edit card' })).not.toBeInTheDocument();
  });

  it('Escape cancels the edit without saving', async () => {
    const h = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'edit' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'edit card' }), 'zzz{Escape}');
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('old text')).toBeInTheDocument();
  });

  it('hides edit for cards you cannot modify', () => {
    renderCard({ canModify: false });
    expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument();
  });

  it('disables upvote when out of votes', () => {
    renderCard({ canVote: false });
    expect(screen.getByRole('button', { name: 'upvote' })).toBeDisabled();
  });
});
