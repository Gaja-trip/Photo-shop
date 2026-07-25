import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const metadataBase = host ? new URL(`${protocol}://${host}`) : undefined;

  return {
    metadataBase,
    title: "오늘, 파리 — 나만의 인생사진 포토부스",
    description:
      "에펠탑과 자전거가 보이는 파리 배경에서 촬영한 듯한 나만의 4:5 인생사진을 만들어 보세요.",
    openGraph: {
      title: "오늘, 파리",
      description: "카메라를 켜면, 오늘의 배경은 파리.",
      locale: "ko_KR",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1731,
          height: 909,
          alt: "오늘, 파리 웹 포토부스",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "오늘, 파리",
      description: "카메라를 켜면, 오늘의 배경은 파리.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
