import { NextResponse } from "next/server";
import { jwtVerify } from "jose/jwt/verify";

const PUBLIC_PATHS = ["/login"];
const ROLE_ROOTS = [
  "/admin",
  "/manager",
  "/strategist",
  "/videographer",
  "/editor",
  "/designer",
  "/posting",
];

function isPublicPath(pathname) {
  if (PUBLIC_PATHS.includes(pathname)) {
    return true;
  }
  if (pathname.startsWith("/assets/")) {
    return true;
  }
  if (pathname.startsWith("/api/")) {
    return true;
  }
  return false;
}

function getDashboardRoute(payload) {
  if (typeof payload.dashboardRoute === "string" && payload.dashboardRoute.startsWith("/")) {
    return payload.dashboardRoute;
  }
  if (payload.roleType === "admin") return "/admin";
  if (payload.roleType === "manager") return "/manager";
  return "/";
}

function isWithinRoute(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("rangreel_token")?.value;

  if (!token) {
    if (isPublicPath(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const dashboardRoute = getDashboardRoute(payload);

    if (pathname === "/login") {
      return NextResponse.redirect(new URL(dashboardRoute, request.url));
    }

    if (payload.mustChangePass === true && pathname !== "/change-password") {
      return NextResponse.redirect(new URL("/change-password", request.url));
    }

    if (payload.mustChangePass !== true && pathname === "/change-password") {
      return NextResponse.redirect(new URL(dashboardRoute, request.url));
    }

    if (pathname === "/") {
      return NextResponse.redirect(new URL(dashboardRoute, request.url));
    }

    const requestedRoleRoot = ROLE_ROOTS.find((root) => isWithinRoute(pathname, root));
    if (requestedRoleRoot && !isWithinRoute(pathname, dashboardRoute)) {
      return NextResponse.redirect(new URL(dashboardRoute, request.url));
    }

    return NextResponse.next();
  } catch (error) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
