'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

export interface Me { id: string; email: string; fullName: string; roles: string[]; permissions: string[] }
const Ctx = createContext<{ me: Me | null; can: (...p: string[]) => boolean; reload: () => void }>({ me: null, can: () => false, reload: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const load = () => api.get<Me>('/auth/me').then(setMe).catch(() => setMe(null));
  useEffect(() => { load(); }, []);
  const can = (...p: string[]) => !!me && p.some((x) => me.permissions.includes(x));
  return <Ctx.Provider value={{ me, can, reload: load }}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);
