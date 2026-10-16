import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MyMusic", template: "%s · MyMusic" },
  description: "Your personal, permanent music library built on YouTube.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070711",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
