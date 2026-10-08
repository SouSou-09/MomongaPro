import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'モモニガウォッチャー — momon-ga 作品モニター',
  description:
    'momon-ga の同人誌・商業誌・急上昇・人気作品リストを自動スクレイピングし、作品を検索・閲覧できるサイト。',
  applicationName: 'Momon-ga Watcher',
};

export const viewport: Viewport = {
  themeColor: '#0b0e14',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
