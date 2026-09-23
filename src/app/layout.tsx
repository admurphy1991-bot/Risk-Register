import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sansom Risk Register",
  description: "Risk register with AI-assisted editing and health & safety system integration.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
