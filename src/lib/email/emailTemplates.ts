import { buildUnsubscribeUrl, getAppOrigin } from './emailService';
import type { EmailTemplateType } from '../../types';

interface TemplateOutput {
  subject: string;
  html: string;
  text: string;
}

// ─── Shared HTML shell ────────────────────────────────────────────────────────

function wrap(
  memberId: string,
  notifType: EmailTemplateType,
  bodyHtml: string,
  bodyText: string,
  subject: string
): TemplateOutput {
  const unsubUrl = buildUnsubscribeUrl(memberId, notifType);
  const origin = getAppOrigin();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#E31837;padding:24px 32px;">
        <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">BLW York Hub</p>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:12px;">York University</p>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:32px;">
        ${bodyHtml}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;">
        <p style="margin:0;color:#999;font-size:12px;text-align:center;">
          You're receiving this because you're a member of BLW York Hub at York University.<br/>
          <a href="${unsubUrl}" style="color:#E31837;text-decoration:none;">Unsubscribe from this type of notification</a>
          &nbsp;·&nbsp;
          <a href="${origin}/email-preferences" style="color:#999;text-decoration:none;">Manage preferences</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html, text: bodyText };
}

function p(text: string) {
  return `<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${text}</p>`;
}
function h2(text: string) {
  return `<h2 style="margin:0 0 16px;color:#111;font-size:18px;font-weight:bold;">${text}</h2>`;
}
function infoBox(rows: Array<[string, string]>) {
  const cells = rows
    .map(
      ([label, val]) =>
        `<tr><td style="padding:6px 12px;color:#666;font-size:13px;font-weight:600;width:140px;">${label}</td><td style="padding:6px 12px;color:#333;font-size:13px;">${val}</td></tr>`
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:6px;margin-bottom:20px;width:100%;">${cells}</table>`;
}
function btn(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;background:#E31837;color:#ffffff;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none;">${label}</a>`;
}

// ─── Template 1: Meeting Reminder (8 AM) ─────────────────────────────────────

export interface MeetingReminderData {
  memberId: string;
  memberName: string;
  meetingName: string;
  date: string;
  time: string;
  endTime?: string;
  location?: string;
  zoomLink?: string;
  meetingUrl: string;
}

export function meetingReminderTemplate(data: MeetingReminderData): TemplateOutput {
  const subject = `Don't forget: ${data.meetingName} today at ${data.time}`;
  const locationLine = data.zoomLink
    ? `<a href="${data.zoomLink}" style="color:#E31837;">${data.zoomLink}</a>`
    : data.location ?? 'TBD';

  const bodyHtml = `
    ${h2('Friendly Reminder')}
    ${p(`Hi ${data.memberName},`)}
    ${p('This is a friendly reminder about today\'s meeting:')}
    ${infoBox([
      ['Meeting', data.meetingName],
      ['Time', data.endTime ? `${data.time} – ${data.endTime}` : data.time],
      [data.zoomLink ? 'Join' : 'Location', locationLine],
    ])}
    ${p('We look forward to seeing you!')}
    <p style="margin:0 0 16px;">${btn('View Meeting', data.meetingUrl)}</p>
    ${p('<em>— BLW York Hub</em>')}`;

  const bodyText = `Hi ${data.memberName},\n\nReminder: ${data.meetingName} is today at ${data.time}.\n\n${data.location ? `Location: ${data.location}` : ''}\n${data.zoomLink ? `Join: ${data.zoomLink}` : ''}`;

  return wrap(data.memberId, 'meeting_reminder_8am', bodyHtml, bodyText, subject);
}

// ─── Template 2: Meeting Reminder (1 hour before) ────────────────────────────

export function meetingReminderHourTemplate(data: MeetingReminderData): TemplateOutput {
  const subject = `${data.meetingName} starts in 1 hour!`;
  const locationLine = data.zoomLink
    ? `<a href="${data.zoomLink}" style="color:#E31837;">${data.zoomLink}</a>`
    : data.location ?? 'TBD';

  const bodyHtml = `
    ${h2('Starting Soon!')}
    ${p(`Hi ${data.memberName},`)}
    ${p(`<strong>${data.meetingName}</strong> starts in just 1 hour!`)}
    ${infoBox([
      ['Meeting', data.meetingName],
      ['Time', data.endTime ? `${data.time} – ${data.endTime}` : data.time],
      [data.zoomLink ? 'Join' : 'Location', locationLine],
    ])}
    <p style="margin:0 0 16px;">${btn('View Meeting', data.meetingUrl)}</p>
    ${p('<em>— BLW York Hub</em>')}`;

  const bodyText = `Hi ${data.memberName},\n\n${data.meetingName} starts in 1 hour!\n\nTime: ${data.time}\n${data.zoomLink ? `Join: ${data.zoomLink}` : `Location: ${data.location}`}`;

  return wrap(data.memberId, 'meeting_reminder_1hr', bodyHtml, bodyText, subject);
}

// ─── Template 3: Message of the Week ─────────────────────────────────────────

export interface MessageNotifData {
  memberId: string;
  memberName: string;
  messageTitle: string;
  authorName: string;
  preview: string;
  driveLink?: string;
  messageUrl: string;
}

export function messageOfWeekTemplate(data: MessageNotifData): TemplateOutput {
  const subject = `New message: ${data.messageTitle}`;
  const bodyHtml = `
    ${h2('New Message Posted')}
    ${p(`Hi ${data.memberName},`)}
    ${p('A new message has been posted:')}
    ${infoBox([
      ['Title', data.messageTitle],
      ['From', data.authorName],
    ])}
    <div style="background:#f7f7f7;border-left:3px solid #E31837;padding:12px 16px;margin-bottom:20px;border-radius:0 6px 6px 0;">
      <p style="margin:0;color:#555;font-size:14px;font-style:italic;">"${data.preview}..."</p>
    </div>
    ${data.driveLink ? `<p style="margin:0 0 8px;"><a href="${data.driveLink}" style="color:#E31837;">Additional resource →</a></p>` : ''}
    <p style="margin:0 0 16px;">${btn('Read Full Message', data.messageUrl)}</p>`;

  const bodyText = `Hi ${data.memberName},\n\nNew message: "${data.messageTitle}" by ${data.authorName}\n\n${data.preview}...\n\nRead: ${data.messageUrl}`;

  return wrap(data.memberId, 'message_notification', bodyHtml, bodyText, subject);
}

// ─── Template 4: Habit Streak Milestone ──────────────────────────────────────

export interface HabitMilestoneData {
  memberId: string;
  memberName: string;
  habitName: string;
  streak: number;
  bestStreak: number;
  habitUrl: string;
}

export function habitStreakTemplate(data: HabitMilestoneData): TemplateOutput {
  const subject = `Congrats on your ${data.habitName} streak!`;
  const bodyHtml = `
    ${h2('Amazing Streak!')}
    ${p(`Hi ${data.memberName},`)}
    ${p(`You've completed <strong>${data.habitName}</strong> for <strong>${data.streak} days in a row!</strong>`)}
    ${p('Keep it up! Your consistency is inspiring.')}
    ${infoBox([
      ['Current streak', `${data.streak} days`],
      ['Best streak', `${data.bestStreak} days`],
    ])}
    <p style="margin:0 0 16px;">${btn('View Progress', data.habitUrl)}</p>`;

  const bodyText = `Hi ${data.memberName},\n\nAmazing! You've completed ${data.habitName} for ${data.streak} days in a row!\n\nCurrent streak: ${data.streak} days\nBest streak: ${data.bestStreak} days\n\nView progress: ${data.habitUrl}`;

  return wrap(data.memberId, 'habit_milestone', bodyHtml, bodyText, subject);
}

// ─── Template 5: Missing Devotional Reminder ─────────────────────────────────

export interface DevotionalReminderData {
  memberId: string;
  memberName: string;
  title: string;
  pages: string;
  devotionalUrl: string;
}

export function devotionalReminderTemplate(data: DevotionalReminderData): TemplateOutput {
  const subject = `You haven't read today's devotional yet`;
  const bodyHtml = `
    ${h2('Today\'s Devotional')}
    ${p(`Hi ${data.memberName},`)}
    ${p('Just a reminder: you haven\'t read today\'s devotional yet!')}
    ${infoBox([
      ['Devotional', data.title],
      ['Pages', data.pages],
    ])}
    ${p('Take 10 minutes to read and be inspired.')}
    <p style="margin:0 0 16px;">${btn('Read Devotional', data.devotionalUrl)}</p>`;

  const bodyText = `Hi ${data.memberName},\n\nYou haven't read today's devotional yet!\n\nTitle: ${data.title}\nPages: ${data.pages}\n\nRead: ${data.devotionalUrl}`;

  return wrap(data.memberId, 'devotional_reminder', bodyHtml, bodyText, subject);
}

// ─── Template 6: Testimony Approved ──────────────────────────────────────────

export interface TestimonyApprovedData {
  memberId: string;
  memberName: string;
  testimonyTitle: string;
  visibility: string;
  testimonyUrl: string;
}

export function testimonyApprovedTemplate(data: TestimonyApprovedData): TemplateOutput {
  const subject = `Your testimony has been approved!`;
  const bodyHtml = `
    ${h2('Testimony Approved')}
    ${p(`Hi ${data.memberName},`)}
    ${p('Thank you for sharing your testimony! It has been approved and is now visible to <strong>' + data.visibility + '</strong>.')}
    ${infoBox([['Testimony', `"${data.testimonyTitle}"`]])}
    <p style="margin:0 0 16px;">${btn('View Shared Testimony', data.testimonyUrl)}</p>`;

  const bodyText = `Hi ${data.memberName},\n\nYour testimony "${data.testimonyTitle}" has been approved and is now visible to ${data.visibility}.\n\nView: ${data.testimonyUrl}`;

  return wrap(data.memberId, 'testimony_approved', bodyHtml, bodyText, subject);
}

// ─── Template 7: Account Approved ────────────────────────────────────────────

export interface AccountApprovedData {
  memberId: string;
  memberName: string;
  loginUrl: string;
}

export function accountApprovedTemplate(data: AccountApprovedData): TemplateOutput {
  const subject = 'Your BLW York Hub account is ready';

  const bodyHtml = `
    ${h2('Account Approved!')}
    ${p(`Hi ${data.memberName},`)}
    ${p('Your BLW York Hub account has been approved. You can now sign in and access the hub.')}
    <p style="margin:0 0 24px;">${btn('Sign in to BLW York Hub', data.loginUrl)}</p>
    ${p(`Or copy this link: <a href="${data.loginUrl}" style="color:#E31837;">${data.loginUrl}</a>`)}
    ${p('<em>— BLW York Hub</em>')}`;

  const bodyText = `Hi ${data.memberName},\n\nYour BLW York Hub account has been approved. You can now sign in using the account you created.\n\nSign in here: ${data.loginUrl}\n\n— BLW York Hub`;

  return wrap(data.memberId, 'account_approved', bodyHtml, bodyText, subject);
}

// ─── Template 8: Generic ──────────────────────────────────────────────────────

export interface GenericTemplateData {
  memberId: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

export function genericTemplate(data: GenericTemplateData): TemplateOutput {
  return wrap(data.memberId, 'generic', data.htmlBody, data.textBody, data.subject);
}

export function renderSampleEmailTemplate(type: EmailTemplateType): TemplateOutput {
  const origin = getAppOrigin();
  switch (type) {
    case 'meeting_reminder_8am':
      return meetingReminderTemplate({
        memberId: 'preview',
        memberName: 'Member',
        meetingName: 'Cell Fellowship',
        date: new Date().toISOString().split('T')[0],
        time: '6:00 PM',
        endTime: '8:00 PM',
        location: 'York Lanes',
        meetingUrl: `${origin}/meetings`,
      });
    case 'meeting_reminder_1hr':
      return meetingReminderHourTemplate({
        memberId: 'preview',
        memberName: 'Member',
        meetingName: 'Cell Fellowship',
        date: new Date().toISOString().split('T')[0],
        time: '6:00 PM',
        endTime: '8:00 PM',
        location: 'York Lanes',
        meetingUrl: `${origin}/meetings`,
      });
    case 'message_notification':
      return messageOfWeekTemplate({
        memberId: 'preview',
        memberName: 'Member',
        messageTitle: 'The Power of Fellowship',
        authorName: 'Pastor Chris',
        preview: 'A new message has been posted for this week',
        messageUrl: `${origin}/messages`,
      });
    case 'habit_milestone':
      return habitStreakTemplate({
        memberId: 'preview',
        memberName: 'Member',
        habitName: 'Daily Prayer',
        streak: 7,
        bestStreak: 14,
        habitUrl: `${origin}/habits`,
      });
    case 'devotional_reminder':
      return devotionalReminderTemplate({
        memberId: 'preview',
        memberName: 'Member',
        title: 'Rhapsody of Realities',
        pages: '12-13',
        devotionalUrl: `${origin}/devotionals`,
      });
    case 'testimony_approved':
      return testimonyApprovedTemplate({
        memberId: 'preview',
        memberName: 'Member',
        testimonyTitle: 'God did it',
        visibility: 'members',
        testimonyUrl: `${origin}/testimonies`,
      });
    case 'weekly_digest':
      return genericTemplate({
        memberId: 'preview',
        subject: 'Your weekly BLW York digest',
        htmlBody: `${h2('Weekly Digest')}${p('Here is a quick summary of meetings, messages, and testimonies from this week.')}`,
        textBody: 'Weekly Digest: here is a quick summary from this week.',
      });
    case 'account_approved':
      return accountApprovedTemplate({
        memberId: 'preview',
        memberName: 'Member',
        loginUrl: `${origin}/`,
      });
    case 'generic':
    default:
      return genericTemplate({
        memberId: 'preview',
        subject: 'Christian Club update',
        htmlBody: `${h2('Christian Club Update')}${p('This is a preview of a generic notification email.')}`,
        textBody: 'This is a preview of a generic notification email.',
      });
  }
}
