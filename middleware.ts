import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { signToken, verifyToken } from '@/lib/auth/session';
import { locales, defaultLocale } from '@/i18n/request';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'as-needed' 
});

const protectedRoutes = [
  '/dashboard',
  '/admin',
  '/settings',
  '/contacts',
  '/automation',
  '/templates',
  '/campaigns',
  '/analytics',
  '/calls',
  '/recurring-messages',
  '/bookings',
];

export async function middleware(request: NextRequest) {
  // ─── Subdomain detection: route businesses to public booking page ───
  // Hosts like "barberia-juan.mitiendapro.com" -> rewrite to /b/barberia-juan/...
  // Excludes apex, www, and reserved subdomains.
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  const rootDomain = (process.env.ROOT_DOMAIN || 'mitiendapro.com').toLowerCase();
  let subdomain = '';
  if (host && rootDomain && host.endsWith('.' + rootDomain) && host !== rootDomain) {
    subdomain = host.slice(0, -('.' + rootDomain).length);
  }
  const RESERVED = new Set(['', 'www', 'app', 'api', 'admin', 'mail', 'dashboard']);
  if (subdomain && !RESERVED.has(subdomain) && !request.nextUrl.pathname.startsWith('/api')) {
    // Rewrite to /b/<slug>/<rest>
    const rest = request.nextUrl.pathname === '/' ? '' : request.nextUrl.pathname;
    const url = request.nextUrl.clone();
    url.pathname = `/b/${subdomain}${rest}`;
    return NextResponse.rewrite(url);
  }

  const response = intlMiddleware(request);

  const locale = request.nextUrl.locale || defaultLocale; 

  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session');
  
  const pathWithoutLocale = pathname.replace(/^\/(pt|en|es)/, '') || '/';
  const isProtectedRoute = protectedRoutes.some(route => pathWithoutLocale.startsWith(route));

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in`, request.url));
  }

  if (sessionCookie) {
    try {
      const parsed = await verifyToken(sessionCookie.value);
      const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

      response.cookies.set({
        name: 'session',
        value: await signToken({
          ...parsed,
          expires: expiresInOneDay.toISOString()
        }),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        expires: expiresInOneDay
      });
    } catch (error) {
      console.error('Error updating session:', error);
      response.cookies.delete('session');
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL(`/${locale}/sign-in`, request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|uploads|sounds).*)']
};