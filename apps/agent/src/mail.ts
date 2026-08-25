export type MailResult = { delivered: boolean; via: "resend" | "telegram" | "log" };

export type SendCodeFn = (to: string, code: string) => Promise<MailResult>;

export async function sendLoginCode(opts: {
  to: string;
  code: string;
  resendKey?: string;
  telegramToken?: string;
  telegramChatId?: string;
}): Promise<MailResult> {
  const text = `Your CryptoGrokBot login code is ${opts.code}. It expires in 5 minutes.`;

  const key = opts.resendKey?.trim() ?? "";
  if (key) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: "CryptoGrokBot <login@cryptogrokbot.com>",
          to: [opts.to],
          subject: "CryptoGrokBot login code",
          text,
        }),
      });
      if (res.ok) return { delivered: true, via: "resend" };
    } catch {
      // fall through
    }
  }

  const tg = opts.telegramToken?.trim() ?? "";
  const chat = opts.telegramChatId?.trim() ?? "";
  if (tg && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `CryptoGrokBot email code for ${opts.to}: ${opts.code}` }),
      });
      if (res.ok) return { delivered: true, via: "telegram" };
    } catch {
      // fall through
    }
  }

  console.log(`Dashboard email code for ${opts.to}: ${opts.code}`);
  return { delivered: false, via: "log" };
}
