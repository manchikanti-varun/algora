import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { UIProvider } from '@/components/ui';

// Read the persisted preference before the first paint. Only the three fixed theme values are accepted.
const initTheme = "try{var t=localStorage.getItem('algora.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}";

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
export const metadata: Metadata = { title: { default: 'Algora', template: '%s · Algora' }, description: 'Coding bootcamp progress platform', robots: { index: false, follow: false } };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning className={`${geistSans.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: initTheme }} /></head>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900"><AuthProvider><UIProvider>{children}</UIProvider></AuthProvider></body>
    </html>
  );
}
