-- AlterTable
ALTER TABLE "User" ADD COLUMN "address" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "pincode" TEXT,
ADD COLUMN "licenseNumber" TEXT,
ADD COLUMN "profileComplete" BOOLEAN NOT NULL DEFAULT false;
