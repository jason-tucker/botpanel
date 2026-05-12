import './globals.css'

export const metadata = {
  title: 'Botpanel',
  description: 'Discord admin dashboard for SquishyBot & OtterBot',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
