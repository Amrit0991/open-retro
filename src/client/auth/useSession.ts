import { useEffect, useState } from 'react';
import { api } from '../api';

export interface User {
  id: string;
  email: string;
  display_name: string;
}

export function useSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .me()
      .then((u) => setUser(u as User | null))
      .finally(() => setLoading(false));
  }, []);
  return { user, loading };
}
