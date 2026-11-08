import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
];

// Trilha 2.0 (planning §4.3): rotas antigas → novas, nas duas árvores (/t/:id e /demo/:key).
// Query string passa junto (ex.: /documentos?doc=x → /turma/documentos?doc=x). 307 por ora:
// as rotas ainda podem mudar até a Fase 9.
const MOVED: [from: string, to: string][] = [
  ['/explorar', '/descobrir'],
  ['/mala', '/turma/mala'],
  ['/documentos', '/turma/documentos'],
  ['/diario', '/turma/diario'],
  ['/editar', '/ajustes'],
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['web-push'],
  async redirects() {
    return [
      ...['/t/:id', '/demo/:id'].flatMap((root) => MOVED.map(([from, to]) => ({ source: root + from, destination: root + to, permanent: false }))),
      { source: '/identidades', destination: '/nova-trilha', permanent: false },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
