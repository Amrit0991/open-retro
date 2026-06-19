import { useState } from 'react';
import { Glyph } from '../ui/Glyph';
import { Icon } from '../ui/icons';

export function LoginPage({
  requestMagicLink,
}: {
  requestMagicLink: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  if (sent)
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="sent">
            <Glyph tone="green" icon="check" size={52} />
            <h2>Check your inbox</h2>
            <p>
              We sent a sign-in link to <b>{email}</b>. It expires in 10 minutes.
            </p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="auth">
      <div className="auth-card">
        <Glyph tone="green" icon="layers" size={52} />
        <h1>Sign in to open-retro</h1>
        <p className="lede">Run real-time retrospectives with your team. No password — we'll email you a link.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await requestMagicLink(email);
            setSent(true);
          }}
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            <span className="icon-c">
              <Icon name="send" size={16} />
            </span>
            Send magic link
          </button>
        </form>
      </div>
    </div>
  );
}
