export type MailResult = { delivered: boolean; via: "resend" | "telegram" | "log" };

export type SendCodeFn = (to: string, code: string) => Promise<MailResult>;

const RESEND_UA = "Mozilla/5.0 (compatible; CryptoGrokBot/1.0; +https://cryptogrokbot.com)";
const DEFAULT_FROM = "CryptoGrokBot <hello@taskra.ai>";

async function sendResendEmail(opts: {
  key: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.key}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": RESEND_UA,
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });
  if (res.ok) return { ok: true, status: res.status };
  let error = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) error = body.message;
  } catch {
    // ignore
  }
  return { ok: false, status: res.status, error };
}

export async function sendLoginCode(opts: {
  to: string;
  code: string;
  resendKey?: string;
  resendFrom?: string;
  telegramToken?: string;
  telegramChatId?: string;
}): Promise<MailResult> {
  const text = `Your CryptoGrokBot password reset code is ${opts.code}. It expires in 5 minutes.`;
  const from = opts.resendFrom?.trim() || DEFAULT_FROM;

  const key = opts.resendKey?.trim() ?? "";
  if (key) {
    try {
      const sent = await sendResendEmail({
        key,
        from,
        to: opts.to,
        subject: "CryptoGrokBot password reset",
        text,
      });
      if (sent.ok) {
        console.log(`Dashboard reset email sent via resend to ${opts.to}`);
        return { delivered: true, via: "resend" };
      }
      console.log(`Resend send failed (${sent.status}): ${sent.error}`);
    } catch (err) {
      console.log(`Resend send error: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  const tg = opts.telegramToken?.trim() ?? "";
  const chat = opts.telegramChatId?.trim() ?? "";
  if (tg && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `CryptoGrokBot reset code for ${opts.to}: ${opts.code}` }),
      });
      if (res.ok) return { delivered: true, via: "telegram" };
    } catch {
      // fall through
    }
  }

  console.log(`Dashboard email code for ${opts.to}: ${opts.code}`);
  return { delivered: false, via: "log" };
}

/** Email Chief when a chance queues. Telegram is sent separately by the agent loop. */
export async function sendDeskAlert(opts: {
  to: string;
  subject: string;
  text: string;
  resendKey?: string;
  resendFrom?: string;
}): Promise<MailResult> {
  const to = opts.to.trim();
  const key = opts.resendKey?.trim() ?? "";
  const from = opts.resendFrom?.trim() || DEFAULT_FROM;
  if (key && to.includes("@")) {
    try {
      const sent = await sendResendEmail({
        key,
        from,
        to,
        subject: opts.subject.slice(0, 120),
        text: opts.text.slice(0, 4000),
      });
      if (sent.ok) return { delivered: true, via: "resend" };
      console.log(`Resend alert failed (${sent.status}): ${sent.error}`);
    } catch (err) {
      console.log(`Resend alert error: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  console.log(`Desk alert for ${to || "chief"}: ${opts.subject}\n${opts.text}`);
  return { delivered: false, via: "log" };
}
