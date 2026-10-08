import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { THEME_INIT_SCRIPT, ThemeProvider } from '@/lib/theme';

export const metadata: Metadata = { title: 'L1V WO & Inventory', description: 'Work Order & Inventory ISP' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body>
        <ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
