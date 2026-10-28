BEGIN;

ALTER TABLE refund_obligations
  DROP CONSTRAINT IF EXISTS refund_obligations_reason_check,
  ADD CONSTRAINT refund_obligations_reason_check CHECK (
    reason IN ('customer_cancellation','late_waitlist_payment','late_booking_payment',
      'supplement_failure','insurance_failure','departure_shortfall')
  );

COMMIT;
