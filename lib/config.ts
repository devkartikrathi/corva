/**
 * Knobs declared on the source designs (`data-props`). The designs declared
 * them but never wired them up; here they are real.
 */

/** From `Corva App.dc.html` — the tenant console. */
export const config = {
  /** Priority at or above which a score is drawn in the accent colour. */
  accentPriorityThreshold: 75,
  /** Show the "why this number" score breakdown on Customer 360. */
  showAiRationale: true,
  /** Row density for tables and list rows. */
  density: "Comfortable" as "Comfortable" | "Compact",
};

/** Vertical cell padding driven by `density`. */
export const rowPadY = config.density === "Compact" ? 6 : 11;

/** From `Corva Operator Console.dc.html` — the platform operator console. */
export const operatorConfig = {
  /**
   * Show the panel explaining that staff cannot read a tenant's transcripts
   * without a time-boxed, audited grant.
   */
  showSupportAccessGuard: true,
  /** AI health at or below which a tenant's bar turns accent. */
  healthThreshold: 70,
};
