"use client";

import { UserButton } from "@clerk/nextjs";

/**
 * The signed-in person's account menu — profile, security, sign out.
 *
 * Only mounted when real sign-in is on; in demo mode there is no Clerk
 * provider to mount it into, and the sidebar's profile switcher stands in.
 */
export function AccountMenu() {
  return <UserButton />;
}
