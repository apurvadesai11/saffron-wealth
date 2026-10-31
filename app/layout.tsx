import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_TOKENS } from "@/lib/theme-tokens";
import { THEME_COOKIE, parseThemePreference, themeAttribute } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Saffron Wealth",
  description: "Personal budget and expense tracker",
};

// Mobile browser chrome follows the OS theme. An explicit override on the
// profile page doesn't reach it — a media query is all themeColor accepts.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_TOKENS.light.surface },
    { media: "(prefers-color-scheme: dark)", color: THEME_TOKENS.dark.surface },
  ],
};

// Reading the cookie makes this layout dynamic, which costs nothing here:
// proxy.ts gives every page a per-request CSP nonce, so no page is static.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" data-theme={themeAttribute(theme)}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
