"use client";

import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { IncidentUpdateForm } from "./IncidentUpdateForm";

/**
 * The two things you do about an open incident, on the screen where you first
 * see it.
 *
 * The fleet view is where an operator finds out something is wrong, so making
 * them navigate to Reliability to say anything about it costs the minutes that
 * matter most. Posting expands the same form the Reliability page uses rather
 * than a second, smaller one — one incident update form, two places to reach it.
 *
 * "Fail over" only appears for an incident that names a region, because that
 * is the only kind there is anything to fail over from.
 */
export function FleetIncidentActions({
  incidentId,
  regionScoped,
  onFailOver,
  onPost,
}: {
  incidentId: string;
  regionScoped: boolean;
  onFailOver: (incidentId: string) => Promise<unknown>;
  onPost: (
    incidentId: string,
    stage: "investigating" | "identified" | "monitoring" | "resolved",
    body: string,
  ) => Promise<unknown>;
}) {
  const [posting, setPosting] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
        {regionScoped && (
          <ActionButton
            action={() => onFailOver(incidentId)}
            variant="dark-primary"
            pendingLabel="Failing over…"
            confirm="Move traffic off this region now? Companies stay in their own data region; only serving moves."
            style={{ fontSize: 11, fontWeight: 700, padding: "7px 10px" }}
          >
            Fail over now
          </ActionButton>
        )}
        <button
          type="button"
          className="hov-invert-dark"
          aria-expanded={posting}
          onClick={() => setPosting((v) => !v)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            border: "1px solid var(--color-bg)",
            padding: "6px 10px",
          }}
        >
          {posting ? "Cancel" : "Post status update"}
        </button>
      </div>

      {posting && (
        <div style={{ marginTop: 10 }}>
          <IncidentUpdateForm
            incidentId={incidentId}
            onPost={async (id, stage, body) => {
              await onPost(id, stage, body);
              setPosting(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
