import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ortho UX Tester",
  description:
    "Persona-driven UX testing for orthodontic practice management prototypes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
