import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@jirawatpyk/aura-tokens/aura-fonts.local.css';
import { ColorSchemeScript } from '@jirawatpyk/aura-react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'DxT Monitor', template: '%s · DxT Monitor' },
  description: 'DxT website monitoring and incident automation',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
