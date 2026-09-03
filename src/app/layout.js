import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BusinessProvider } from "../context/BusinessContext";
import KeyboardShortcuts from "../components/shortcuts/KeyboardShortcuts";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Ganpati Neer",
  description: "Ganpati Neer dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="light">
      <body className="main">
        <BusinessProvider>
          {children}
          <KeyboardShortcuts />
        </BusinessProvider>
      </body>
    </html>
  );
}
