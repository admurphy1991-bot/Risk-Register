import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight route guard: redirects to /login when the session cookie is
// missing. This is just UX — every API route and server page still calls
// getSession()/requireUser() itself, which is the real authorization check.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("rr_session");

  const isPublic = pathname === "/login" || pathname.startsWith("/api/");

  if (!hasSession && !isPublic) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:jpg|jpeg|png|svg|ico|webp)$).*)"],
};
