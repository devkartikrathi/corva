/**
 * Sending email.
 *
 * Through Resend, installed from the Vercel Marketplace (`RESEND_API_KEY`).
 * Every caller treats email as best-effort: a lead is saved and a follow-up
 * exists whether or not the confirmation went out, so a missing key or a
 * provider outage is logged and reported back, never thrown into the flow that
 * was saving someone's details.
 *
 * Until a business's own domain is verified in Resend, mail goes from
 * Resend's shared test sender — which only delivers to the account owner's
 * address. `EMAIL_FROM` switches to the real sender once DNS is done.
 */

const FROM = process.env.EMAIL_FROM ?? "Corva <onboarding@resend.dev>";

/** Where links in emails point. */
export const APP_URL = (
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  // On Vercel, the project's production address unless told otherwise.
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

export type EmailResult = { sent: boolean; id?: string; reason?: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Shown as the sender's name, e.g. the business the email is from. */
  fromName?: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email] RESEND_API_KEY not set — not sending "${input.subject}" to ${input.to}`);
    return { sent: false, reason: "Email is not configured yet." };
  }
  const from = input.fromName ? FROM.replace(/^[^<]*</, `${input.fromName.replace(/[<>"]/g, "")} <`) : FROM;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      console.error(`[email] Resend refused "${input.subject}" to ${input.to}: ${res.status} ${body.message ?? ""}`);
      return { sent: false, reason: body.message ?? `Resend responded ${res.status}` };
    }
    return { sent: true, id: body.id };
  } catch (e) {
    console.error(`[email] could not reach Resend:`, (e as Error).message);
    return { sent: false, reason: "The email service could not be reached." };
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable email: a heading, some lines, maybe a button. */
export function layout(opts: { heading: string; lines: string[]; button?: { label: string; href: string }; footer?: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#141414">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<h1 style="font-size:22px;line-height:1.2;margin:0 0 16px">${escape(opts.heading)}</h1>
${opts.lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${escape(l)}</p>`).join("")}
${
  opts.button
    ? `<p style="margin:22px 0"><a href="${escape(opts.button.href)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px">${escape(opts.button.label)}</a></p>`
    : ""
}
${opts.footer ? `<p style="font-size:12px;color:#777;margin-top:28px">${escape(opts.footer)}</p>` : ""}
</div></body></html>`;
  const text = [opts.heading, "", ...opts.lines, ...(opts.button ? ["", `${opts.button.label}: ${opts.button.href}`] : []), ...(opts.footer ? ["", opts.footer] : [])].join("\n");
  return { html, text };
}

/** The invitation to join a business on Corva. */
export function inviteEmail(opts: { orgName: string; role: string; invitedBy: string; token: string }) {
  const href = `${APP_URL}/invite/${opts.token}`;
  return {
    subject: `You're invited to ${opts.orgName} on Corva`,
    ...layout({
      heading: `Join ${opts.orgName} on Corva`,
      lines: [
        `${opts.invitedBy} has invited you to ${opts.orgName} as ${opts.role}.`,
        "Corva is where the team picks up the calls, leads and follow-ups that the AI assistant handles for the business.",
        "Create your account with this email address and you'll land straight in the workspace.",
      ],
      button: { label: "Accept the invitation", href },
      footer: "If you weren't expecting this, you can ignore it — nothing happens until you accept.",
    }),
  };
}
