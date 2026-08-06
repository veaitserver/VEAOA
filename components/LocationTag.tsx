/**
 * 上课地点的统一展示：线上课没有教室，显示「线上」徽标；线下课显示教室名。
 *
 * 单独抽出来是因为「线上 = classroomId 为空」这条约定散落在七八个列表里，
 * 各写各的就会出现有的地方显示「—」、有的地方显示空白。
 */
import { DeliveryMode, DELIVERY_MODE_LABELS } from "@/lib/enums";

export default function LocationTag({
  deliveryMode,
  classroomName,
  className = "",
}: {
  deliveryMode?: string | null;
  classroomName?: string | null;
  className?: string;
}) {
  if (deliveryMode === DeliveryMode.ONLINE) {
    return (
      <span className={`inline-block text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-medium ${className}`}>
        {DELIVERY_MODE_LABELS.ONLINE}
      </span>
    );
  }
  return <span className={className}>{classroomName ?? "—"}</span>;
}
