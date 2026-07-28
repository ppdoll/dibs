/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 모노레포 공용 패키지를 소스째로 가져다 쓴다 (별도 빌드 단계 없이).
  transpilePackages: ['@dibs/shared'],
  images: {
    remotePatterns: [
      // Vercel Blob에 올라간 시설/이벤트 이미지
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      // 구글 로그인 프로필 이미지
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
