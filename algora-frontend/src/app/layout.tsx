import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { UIProvider } from '@/components/ui';

// Read the persisted preference before the first paint. Only the three fixed theme values are accepted.
const initTheme = "document.title=document.title||'Algora';try{var t=localStorage.getItem('algora.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}";

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
// No metadata title here: every page sets its own tab title on the client (usePageTitle), and a metadata title would
// be re-applied by Next after hydration and overwrite it. The inline script below gives the first paint a title.
export const metadata: Metadata = { description: 'Coding bootcamp progress platform', robots: { index: false, follow: false } };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: initTheme }} /></head>
      <body className="min-h-full bg-canvas font-sans text-[14px] text-fg"><AuthProvider><UIProvider>{children}</UIProvider></AuthProvider></body>
    </html>
  );
}
