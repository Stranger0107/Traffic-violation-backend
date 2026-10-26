-- Demo payment module: enums, Payment table, constraints and indexes.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CREDIT_CARD', 'DEBIT_CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "citizenId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");
CREATE INDEX "Payment_challanId_idx" ON "Payment"("challanId");
CREATE INDEX "Payment_citizenId_idx" ON "Payment"("citizenId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE UNIQUE INDEX "Payment_citizenId_idempotencyKey_key" ON "Payment"("citizenId", "idempotencyKey");

-- Hard database-level guarantee: at most one SUCCESS payment per challan.
-- This is the last line of defence against concurrent double payments.
CREATE UNIQUE INDEX "Payment_one_success_per_challan" ON "Payment"("challanId") WHERE "status" = 'SUCCESS';

-- Amount must be a positive snapshot.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

-- Foreign keys
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "Challan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
