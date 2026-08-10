import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewLedger, denyCrossCampus, denyNotMyStudent, type SessionUser } from "@/lib/permissions";
import { studentBalance } from "@/lib/ledger";

/** 学生账户流水 + 余额。涉及金额，教务/老师无权查看。 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewLedger(sessionUser)) {
    return NextResponse.json({ error: "无权查看账户流水" }, { status: 403 });
  }

  const { id } = await params;
  const student = await prisma.student.findUnique({
    where: { id },
    select: { campusId: true, salesId: true, studentManagerId: true },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, student.campusId) ?? denyNotMyStudent(sessionUser, student);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const [entries, balance] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { studentId: id },
      include: {
        creator: { select: { name: true } },
        package: { select: { id: true, grade: { select: { name: true } }, subject: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    studentBalance(prisma, id),
  ]);

  return NextResponse.json({ entries, balance });
}
