import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import { LoginPage } from '../../src/client/auth/LoginPage';

it('submits email and shows the check-inbox confirmation', async () => {
  const requestMagicLink = vi.fn().mockResolvedValue(undefined);
  render(<LoginPage requestMagicLink={requestMagicLink} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  expect(requestMagicLink).toHaveBeenCalledWith('a@b.com');
  expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
});
