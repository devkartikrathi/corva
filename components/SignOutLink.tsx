"use client";

import { SignOutButton } from "@clerk/nextjs";

/**
 * Isolated so the Clerk component is only ever mounted on the branch where
 * the provider exists — in demo mode there is no provider to mount it into.
 */
export function SignOutLink() {
  return (
    <SignOutButton>
      <button
        type="button"
        className="hov-invert"
        style={{
          fontSize: 13,
          fontWeight: 600,
          border: "2px solid var(--color-text)",
          padding: "12px 18px",
        }}
      >
        Sign out and try another account
      </button>
    </SignOutButton>
  );
}
