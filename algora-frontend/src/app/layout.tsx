import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { UIProvider } from '@/components/ui';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
export const metadata: Metadata = { title: { default: 'Algora', template: '%s · Algora' }, description: 'Coding bootcamp progress platform', robots: { index: false, follow: false } };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900"><AuthProvider><UIProvider>{children}</UIProvider></AuthProvider></body>
    </html>
  );
}
