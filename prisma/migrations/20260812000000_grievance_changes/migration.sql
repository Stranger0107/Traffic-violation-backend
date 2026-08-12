-- Migration: grievance_changes 2026-08-12

-- Add new enum values
DO $$ BEGIN
    BEGIN
        ALTER TYPE "EvidenceSource" ADD VALUE 'CITIZEN';
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER TYPE "ChallanStatus" ADD VALUE 'DISPUTED';
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END;
END$$;

-- Ensure Grievance enums exist (safe if already present)
DO $$ BEGIN
    BEGIN
        CREATE TYPE "GrievanceReason" AS ENUM ('FALSE_DETECTION','VEHICLE_NOT_MINE','NOT_MYSELF_DRIVING','CHALLAN_ALREADY_PAID','OTHER');
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        CREATE TYPE "GrievanceStatus" AS ENUM ('PENDING','UNDER_REVIEW','APPROVED','REJECTED');
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END;
END$$;
-- Create Grievance table (only if not exists)
CREATE TABLE IF NOT EXISTS "Grievance" (
  "id" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "citizenId" TEXT NOT NULL,
  "reason" "GrievanceReason" NOT NULL,
  "description" TEXT,
  "status" "GrievanceStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "officerNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Grievance_pkey" PRIMARY KEY ("id")
);

-- Foreign keys for Grievance
ALTER TABLE "Grievance"
ADD CONSTRAINT "Grievance_challanId_fkey"
FOREIGN KEY ("challanId")
REFERENCES "Challan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "Grievance"
ADD CONSTRAINT "Grievance_citizenId_fkey"
FOREIGN KEY ("citizenId")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Remove obsolete columns from Grievance if present (safe no-op if table newly created)
ALTER TABLE "Grievance" DROP COLUMN IF EXISTS "depositAmount";
ALTER TABLE "Grievance" DROP COLUMN IF EXISTS "depositPaid";
ALTER TABLE "Grievance" DROP COLUMN IF EXISTS "refundIssued";

-- Create GrievanceEvidence table
CREATE TABLE IF NOT EXISTS "GrievanceEvidence" (
  "id" TEXT NOT NULL,
  "grievanceId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "imageKitFileId" TEXT NOT NULL,
  "uploadedBy" "EvidenceSource" NOT NULL DEFAULT 'TRAFFIC_OFFICER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrievanceEvidence_pkey" PRIMARY KEY ("id")
);

-- Foreign key for grievance evidence
ALTER TABLE "GrievanceEvidence"
ADD CONSTRAINT "GrievanceEvidence_grievanceId_fkey"
FOREIGN KEY ("grievanceId")
REFERENCES "Grievance"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- Create RefundStatus enum and Refund table
DO $$ BEGIN
    BEGIN
        CREATE TYPE "RefundStatus" AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED');
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END;
END$$;

CREATE TABLE IF NOT EXISTS "Refund" (
  "id" TEXT NOT NULL,
  "challanId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- Unique constraint and foreign key for refunds
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_challanId_key" ON "Refund"("challanId");
ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_challanId_fkey"
FOREIGN KEY ("challanId")
REFERENCES "Challan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
