import { useState } from 'react';

export function LoginPage({
  requestMagicLink,
}: {
  requestMagicLink: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) return <p>Check your inbox for a sign-in link.</p>;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await requestMagicLink(email);
        setSent(true);
      }}
    >
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit">Send magic link</button>
    </form>
  );
}
