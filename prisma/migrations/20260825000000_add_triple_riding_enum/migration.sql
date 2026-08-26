-- Add MORE_THAN_2_PEOPLE_ON_BIKE to ViolationType enum
DO $$ BEGIN
    ALTER TYPE "ViolationType" ADD VALUE 'MORE_THAN_2_PEOPLE_ON_BIKE';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END$$;
