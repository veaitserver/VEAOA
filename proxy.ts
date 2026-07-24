export { auth as proxy } from "./lib/auth";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/students/:path*",
    "/packages/:path*",
    "/schedule/:path*",
    "/lessons/:path*",
    "/reports/:path*",
    "/admin/:path*",
    "/api/students/:path*",
    "/api/packages/:path*",
    "/api/schedule/:path*",
    "/api/lessons/:path*",
    "/api/reports/:path*",
    "/api/admin/:path*",
    "/refunds/:path*",
    "/api/refunds/:path*",
  ],
};
