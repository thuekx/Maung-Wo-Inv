import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { THEME_INIT_SCRIPT, ThemeProvider } from '@/lib/theme';
import { BRAND_INIT_SCRIPT } from '@/lib/brand';
import { DialogHost } from '@/lib/dialog';

export const metadata: Metadata = { title: 'MAUNG by LIV', description: 'Marketing · Asset · Unified Network & Governance' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BRAND_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider><AuthProvider>{children}</AuthProvider><DialogHost /></ThemeProvider>
      </body>
    </html>
  );
}
