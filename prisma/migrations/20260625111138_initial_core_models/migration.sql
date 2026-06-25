-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CITIZEN', 'TRAFFIC_OFFICER', 'GRIEVANCE_OFFICER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('NO_HELMET', 'NO_SEATBELT', 'RED_LIGHT_JUMP', 'SPEEDING', 'WRONG_SIDE', 'ILLEGAL_PARKING', 'LANE_VIOLATION');

-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED', 'VEHICLE_NOT_FOUND', 'DUPLICATE_REVIEW', 'CHALLAN_GENERATED');

-- CreateEnum
CREATE TYPE "ChallanStatus" AS ENUM ('ISSUED', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CITIZEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL,
    "modelEventId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "violationType" "ViolationType" NOT NULL,
    "detectedPlate" TEXT NOT NULL,
    "normalizedPlate" TEXT NOT NULL,
    "ocrConfidence" DOUBLE PRECISION NOT NULL,
    "recommendation" TEXT NOT NULL,
    "frameNumber" INTEGER,
    "videoTimestampSec" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "cameraId" TEXT NOT NULL,
    "areaCode" TEXT NOT NULL,
    "locationText" TEXT,
    "evidenceImageUrl" TEXT NOT NULL,
    "plateCropUrl" TEXT,
    "duplicateFlag" BOOLEAN NOT NULL DEFAULT false,
    "duplicateConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "modelVersion" TEXT NOT NULL,
    "rawModelPayload" JSONB NOT NULL,
    "status" "ViolationStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challan" (
    "id" TEXT NOT NULL,
    "challanNumber" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "ChallanStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registrationNumber_key" ON "Vehicle"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Violation_modelEventId_key" ON "Violation"("modelEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Challan_challanNumber_key" ON "Challan"("challanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Challan_violationId_key" ON "Challan"("violationId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challan" ADD CONSTRAINT "Challan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challan" ADD CONSTRAINT "Challan_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
