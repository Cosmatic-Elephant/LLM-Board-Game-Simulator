import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM 보드게임",
  description: "Las Vegas board game simulator with LLM players",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">{children}</body>
    </html>
  );
}
