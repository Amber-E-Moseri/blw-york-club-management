import { supabase } from '../supabase';
import {
  toSendArgs,
  type AudienceSelection,
  type Channel,
  type DraftInput,
} from '../communications/messaging';

// Thin service layer over migration 066. Every authorization decision happens in the database (RLS and the
// security definer functions). This module never builds a recipient list on the client.

export interface PreviewRecipient {
  id: string;
  name: string | null;
  cellId: string | null;
}

export interface AudiencePreview {
  count: number;
  recipients: PreviewRecipient[];
}

export interface DispatchSummary {
  email: { accepted: number; failed: number; skipped: number };
  push: { accepted: number; failed: number; skipped: number };
}

export interface SendResult {
  messageId: string;
  /** Set when the message was stored but external delivery could not be started. The inbox copy still exists. */
  dispatchError: string | null;
  dispatch: DispatchSummary | null;
}

export interface SentMessage {
  id: string;
  subject: string;
  createdAt: string;
  recipientCount: number;
  channels: Channel[];
  /** Counts per channel and status. Individual recipients are not listed here. */
  deliveries: Array<{ channel: Channel; status: string; count: number; reason: string | null }>;
}

export interface InboxMessage {
  messageId: string;
  subject: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

function rpcError(error: { message: string }): Error {
  // Map database codes to readable copy. Unknown errors keep the database message.
  const known: Record<string, string> = {
    not_authorised: 'You are not allowed to send to this audience.',
    outside_cell: 'Cell leaders can message only their own cell.',
    unknown_cell: 'One of the selected cells no longer exists.',
    unknown_group: 'One of the selected groups no longer exists.',
    unknown_recipient: 'One of the selected people no longer exists.',
    empty_audience: 'No active members match this audience.',
    invalid_channels: 'Choose valid delivery channels.',
    invalid_audience: 'Choose a valid audience.',
  };
  const key = Object.keys(known).find((k) => error.message.includes(k));
  return new Error(key ? known[key] : error.message);
}

export async function previewAudience(selection: AudienceSelection): Promise<AudiencePreview> {
  const { data, error } = await supabase.rpc('preview_audience', {
    p_mode: selection.mode,
    p_cell_ids: selection.mode === 'cells' ? selection.cellIds : null,
    p_group_ids: selection.mode === 'saved_groups' ? selection.groupIds : null,
    p_profile_ids: selection.mode === 'explicit' ? selection.profileIds : null,
  });
  if (error) throw rpcError(error);
  const payload = (data ?? { recipients: [], count: 0 }) as {
    count: number;
    recipients: Array<{ id: string; name: string | null; cellId: string | null }>;
  };
  return { count: payload.count, recipients: payload.recipients.map((r) => ({ id: r.id, name: r.name, cellId: r.cellId })) };
}

/**
 * Stores the message through send_message (one database transaction), then asks the dispatcher for the external
 * channels. A dispatch failure does not undo the stored message; it is reported as dispatchError.
 */
export async function sendMessage(draft: DraftInput, idempotencyKey: string): Promise<SendResult> {
  const { data: messageId, error } = await supabase.rpc('send_message', toSendArgs(draft, idempotencyKey));
  if (error) throw rpcError(error);
  const id = messageId as string;

  const needsExternal = draft.channels.some((c) => c !== 'inbox');
  if (!needsExternal) return { messageId: id, dispatchError: null, dispatch: null };

  const { data, error: dispatchError } = await supabase.functions.invoke('dispatch-message', {
    body: { message_id: id },
  });
  if (dispatchError) return { messageId: id, dispatchError: dispatchError.message, dispatch: null };
  return { messageId: id, dispatchError: null, dispatch: data as DispatchSummary };
}

export async function listSentMessages(limit = 30): Promise<SentMessage[]> {
  const { data, error } = await supabase
    .from('communication_messages')
    .select('id, subject, created_at, recipient_count, channels')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: deliveries, error: deliveryError } = await supabase
    .from('communication_deliveries')
    .select('message_id, channel, status, reason')
    .in('message_id', rows.map((r) => r.id));
  if (deliveryError) throw new Error(deliveryError.message);

  return rows.map((row) => {
    const counts = new Map<string, { channel: Channel; status: string; count: number; reason: string | null }>();
    for (const d of (deliveries ?? []).filter((x) => x.message_id === row.id)) {
      const key = `${d.channel}|${d.status}`;
      const entry = counts.get(key) ?? { channel: d.channel as Channel, status: d.status, count: 0, reason: null };
      entry.count += 1;
      entry.reason = entry.reason ?? d.reason;
      counts.set(key, entry);
    }
    return {
      id: row.id,
      subject: row.subject,
      createdAt: row.created_at,
      recipientCount: row.recipient_count,
      channels: row.channels as Channel[],
      deliveries: Array.from(counts.values()),
    };
  });
}

export async function listInbox(limit = 50): Promise<InboxMessage[]> {
  const { data, error } = await supabase
    .from('communication_recipients')
    .select('read_at, created_at, message:communication_messages(id, subject, body, created_at)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.message)
    .map((row) => {
      const m = row.message as unknown as { id: string; subject: string; body: string; created_at: string };
      return { messageId: m.id, subject: m.subject, body: m.body, createdAt: m.created_at, readAt: row.read_at };
    });
}

export async function markMessageRead(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_message_read', { p_message_id: messageId });
  if (error) throw new Error(error.message);
}

export async function listCellsForComposer(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('cells').select('id, name').order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listSavedGroupsForComposer(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('saved_groups').select('id, name').eq('is_active', true).order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listActiveMembersForComposer(): Promise<Array<{ id: string; name: string | null; cellId: string | null }>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, cell_id')
    .eq('status', 'active')
    .order('full_name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name, cellId: p.cell_id }));
}
