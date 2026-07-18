import { prisma } from "@/lib/prisma";
import JoinForm from "./JoinForm";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { token },
    select: { name: true, active: true },
  });

  if (!campaign || !campaign.active) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-slate-800">活动不存在或已结束</h1>
          <p className="text-sm text-slate-500 mt-2">请确认二维码或链接是否正确。</p>
        </div>
      </div>
    );
  }

  const grades = await prisma.grade.findMany({ orderBy: { name: "asc" }, select: { name: true } });

  return <JoinForm token={token} campaignName={campaign.name} grades={grades.map((g) => g.name)} />;
}
