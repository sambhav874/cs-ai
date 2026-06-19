import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/signin", "/signup", "/beta", "/assessment"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/fonts") ||
    pathname === "/favicon.ico" ||
    pathname === "/logo.png";

  if (isPublic) return NextResponse.next();

  const authCookie = request.cookies.get("contractsense_access");
  if (!authCookie?.value) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|favicon\\.ico|logo\\.png|fonts).*)"],
};
