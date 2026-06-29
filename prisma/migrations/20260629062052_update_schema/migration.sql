/*
  Warnings:

  - You are about to drop the column `amount` on the `Challan` table. All the data in the column will be lost.
  - You are about to drop the column `fileType` on the `Evidence` table. All the data in the column will be lost.
  - You are about to drop the column `fileUrl` on the `Evidence` table. All the data in the column will be lost.
  - You are about to drop the column `evidenceImageUrl` on the `Violation` table. All the data in the column will be lost.
  - You are about to drop the column `plateCropUrl` on the `Violation` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[violationId]` on the table `Evidence` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fineAmount` to the `Challan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `imageKitFileId` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Added the required column `imageUrl` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Added the required column `uploadedBy` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `recommendation` on the `Violation` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('AUTO_VERIFY', 'OFFICER_REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('ML_MODEL', 'TRAFFIC_OFFICER');

-- AlterTable
ALTER TABLE "Challan" DROP COLUMN "amount",
ADD COLUMN     "fineAmount" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Evidence" DROP COLUMN "fileType",
DROP COLUMN "fileUrl",
ADD COLUMN     "imageKitFileId" TEXT NOT NULL,
ADD COLUMN     "imageUrl" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedBy" "EvidenceSource" NOT NULL;

-- AlterTable
ALTER TABLE "Violation" DROP COLUMN "evidenceImageUrl",
DROP COLUMN "plateCropUrl",
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
DROP COLUMN "recommendation",
ADD COLUMN     "recommendation" "Recommendation" NOT NULL;

-- CreateIndex
CREATE INDEX "Challan_vehicleId_idx" ON "Challan"("vehicleId");

-- CreateIndex
CREATE INDEX "Challan_status_idx" ON "Challan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_violationId_key" ON "Evidence"("violationId");

-- CreateIndex
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");

-- CreateIndex
CREATE INDEX "Violation_vehicleId_idx" ON "Violation"("vehicleId");

-- CreateIndex
CREATE INDEX "Violation_status_idx" ON "Violation"("status");

-- CreateIndex
CREATE INDEX "Violation_cameraId_idx" ON "Violation"("cameraId");

-- CreateIndex
CREATE INDEX "Violation_detectedAt_idx" ON "Violation"("detectedAt");
