import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MotorLedger",
  description: "Your vehicle's whole service history, built from photos.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
