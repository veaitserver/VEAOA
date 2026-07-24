-- 家长手机号可被多个在读孩子共用：取消全局唯一，改为「同校区+同号+同名」唯一。
-- DropIndex
DROP INDEX "Student_phone_key";

-- CreateIndex
CREATE INDEX "Student_phone_idx" ON "Student"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Student_campusId_phone_name_key" ON "Student"("campusId", "phone", "name");
