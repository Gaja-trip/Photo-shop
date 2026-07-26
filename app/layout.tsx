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
    title: "오늘, 사진 — 파리 인생사진 스튜디오",
    description:
      "10개의 파리 배경을 고르고 약 1.5m 전신 촬영 가이드에 맞춰 나만의 4:5 인생사진을 만들어 보세요.",
    openGraph: {
      title: "오늘, 사진",
      description: "파리에서, 가장 나다운 한 장.",
      locale: "ko_KR",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1731,
          height: 909,
          alt: "오늘, 사진 웹 포토부스",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "오늘, 사진",
      description: "파리에서, 가장 나다운 한 장.",
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
