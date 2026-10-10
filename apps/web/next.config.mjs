/**
 * Mode "satu alamat" (same-origin): bila NEXT_PUBLIC_API_URL dikosongkan, browser hanya bicara ke alamat web ini
 * dan Next meneruskan /api & /uploads ke API lewat nama host docker (API_INTERNAL_URL) — tidak ada IP/port API
 * yang tertanam di build, sehingga IP/domain server bisa berubah tanpa build ulang.
 * @type {import('next').NextConfig}
 */
const internal = (process.env.API_INTERNAL_URL || 'http://api:4000').replace(/\/+$/, '');
const sameOrigin = (process.env.NEXT_PUBLIC_API_URL ?? 'x') === '';
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return sameOrigin ? [{ source: '/api/:path*', destination: `${internal}/api/:path*` }, { source: '/uploads/:path*', destination: `${internal}/uploads/:path*` }] : [];
  },
};
export default nextConfig;
