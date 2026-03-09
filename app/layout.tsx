import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小红书长文转图工作台",
  description: "本地离线优先的长文转小红书风格图片工具"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
