import type { Tone } from '../../shared/protocol';

const AVATAR_TONES: Tone[] = ['green', 'blue', 'coral', 'purple', 'amber', 'pink', 'slate'];

// Stable color per user so the same person reads the same everywhere on the board.
export function toneForUser(userId: string): Tone {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}
