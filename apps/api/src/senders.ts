import nodemailer from 'nodemailer';
import { config } from './config';

const transporter = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!transporter) {
    console.log(`[email dry-run] → ${to} | ${subject}`);
    return 'dry-run';
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text });
  return 'sent';
}

export async function sendTelegram(chatId: string, text: string) {
  if (!config.telegram.token) {
    console.log(`[telegram dry-run] → ${chatId} | ${text.split('\n')[0]}`);
    return 'dry-run';
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  return 'sent';
}
