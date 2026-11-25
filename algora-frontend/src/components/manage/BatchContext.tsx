'use client';
import { createContext, useContext } from 'react';
import type { Batch } from './types';
export const BatchCtx = createContext<{ batch: Batch; reload: () => Promise<void> } | null>(null);
export const useBatch = () => { const c = useContext(BatchCtx); if (!c) throw new Error('useBatch outside batch layout'); return c; };
