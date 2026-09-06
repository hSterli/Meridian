function daysUntil(trialEndDate: string): number {
  const msRemaining = new Date(trialEndDate).getTime() - Date.now();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

export function TrialBanner({
  billingStatus,
  trialEndDate,
}: {
  billingStatus: "trial" | "active" | "past_due" | "cancelled";
  trialEndDate: string | null;
}) {
  if (billingStatus !== "trial" || !trialEndDate) return null;

  const daysRemaining = daysUntil(trialEndDate);

  if (daysRemaining <= 0) {
    return (
      <div className="bg-fail px-4 py-2 text-center text-sm font-semibold text-white">
        Your trial has ended — the org is read-only until payment is added.
      </div>
    );
  }

  const urgent = daysRemaining <= 3;

  return (
    <div
      className={
        urgent
          ? "bg-blocked px-4 py-2 text-center text-sm font-semibold text-white"
          : "bg-surface-container-highest px-4 py-2 text-center text-sm text-ink-secondary"
      }
    >
      {daysRemaining === 1
        ? "Trial ends tomorrow."
        : `Trial — ${daysRemaining} days left.`}
    </div>
  );
}
