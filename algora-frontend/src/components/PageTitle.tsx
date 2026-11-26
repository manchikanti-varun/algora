'use client';
import { usePageTitle } from './ui';
/** Sets the browser tab title from a Server Component page. */
export function PageTitle({ title }: { title: string }) { usePageTitle(title); return null; }
