import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, type SessionUser } from "@/lib/permissions";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const salesId = searchParams.get("salesId");
  const campusId = searchParams.get("campusId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = { status: "ACTIVE" };

  const scope = campusScope(sessionUser, campusId);
  if (scope) where.student = { campusId: scope };
  if (salesId) where.createdById = salesId;
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.confirmedAt = dateFilter;
  }

  const packages = await prisma.coursePackage.findMany({
    where,
    include: {
      student: { select: { name: true, campusId: true, campus: { select: { name: true } } } },
      grade: true, subject: true,
      creator: { select: { id: true, name: true } },
      confirmer: { select: { name: true } },
    },
    orderBy: { confirmedAt: "desc" },
  });

  // Aggregate by sales
  const bySales: Record<string, { name: string; count: number; totalAmount: number; packages: typeof packages }> = {};
  for (const p of packages) {
    const salesId = p.createdById;
    if (!bySales[salesId]) bySales[salesId] = { name: p.creator.name, count: 0, totalAmount: 0, packages: [] };
    bySales[salesId].count += 1;
    bySales[salesId].totalAmount += Number(p.totalAmount);
    bySales[salesId].packages.push(p);
  }

  return NextResponse.json({
    summary: Object.entries(bySales).map(([id, v]) => ({ id, ...v, packages: undefined })),
    total: packages.reduce((s, p) => s + Number(p.totalAmount), 0),
    count: packages.length,
    packages,
  });
}
