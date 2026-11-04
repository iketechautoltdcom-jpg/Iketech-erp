/** The browser talks to the API through this same origin, so the session cookie stays SameSite=Strict and httpOnly. */
// Accepts a full URL (http://api:4000) or Render's internal host:port (iketech-api-xyz:4000).
const RAW = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const API = /^https?:\/\//.test(RAW) ? RAW.replace(/\/+$/, '') : `http://${RAW}`;
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() { return [{ source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }]; },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }];
  },
};
