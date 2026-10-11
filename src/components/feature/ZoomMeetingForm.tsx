import React, { useState } from 'react';
import { Button } from '../foundation/Button';
import { useCreateZoomMeeting } from '../../hooks/useZoom';
import { downloadCalendarInvite } from '../../lib/zoom/zoomIntegration';
import type { ZoomMeetingData, Meeting } from '../../types';

interface Props {
  /** The portal meeting row (must be saved first so we have an ID). */
  meeting: Meeting;
  /** Called after Zoom meeting is successfully created. */
  onZoomCreated?: (data: ZoomMeetingData) => void;
}

/**
 * Embeddable sub-form that lets an admin optionally create a Zoom meeting
 * for an existing portal meeting row. Renders a checkbox; when checked and
 * submitted, calls the Zoom API and updates the meeting row with the result.
 */
export const ZoomMeetingForm: React.FC<Props> = ({ meeting, onZoomCreated }) => {
  const [enabled, setEnabled] = useState(false);
  const [zoomData, setZoomData] = useState<ZoomMeetingData | null>(
    meeting.zoom_created
      ? {
          zoom_meeting_id: meeting.zoom_meeting_id ?? null,
          zoom_join_url: meeting.zoom_join_url ?? null,
          zoom_start_url: meeting.zoom_start_url ?? null,
          zoom_password: meeting.zoom_password ?? null,
          zoom_created: true,
        }
      : null
  );
  const [copied, setCopied] = useState(false);
  const { create, creating, error } = useCreateZoomMeeting();

  const handleCreate = async () => {
    const startTime = new Date(`${meeting.date}T${meeting.time}`).toISOString();
    const durationMinutes = (() => {
      if (!meeting.end_time) return 120;
      const [sh, sm] = meeting.time.split(':').map(Number);
      const [eh, em] = meeting.end_time.split(':').map(Number);
      return (eh * 60 + em) - (sh * 60 + sm);
    })();

    const data = await create(meeting.id, {
      topic: meeting.title,
      startTime,
      durationMinutes,
    });

    if (data) {
      setZoomData(data);
      setEnabled(false);
      onZoomCreated?.(data);
    }
  };

  const handleCopy = () => {
    if (zoomData?.zoom_join_url) {
      navigator.clipboard.writeText(zoomData.zoom_join_url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  // If Zoom meeting already exists, show the link
  if (zoomData?.zoom_created) {
    return (
      <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
        <p className="text-sm font-semibold text-blue-800 mb-2">Zoom Meeting Created</p>
        {zoomData.zoom_join_url && (
          <div className="flex items-center gap-2">
            <a
              href={zoomData.zoom_join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline truncate flex-1"
            >
              {zoomData.zoom_join_url}
            </a>
            <button
              onClick={handleCopy}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium shrink-0"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
        {zoomData.zoom_password && (
          <p className="text-xs text-blue-600 mt-1">Password: {zoomData.zoom_password}</p>
        )}
        <button
          onClick={() => downloadCalendarInvite(meeting)}
          className="mt-2 text-xs text-blue-500 hover:text-blue-700 underline"
        >
          Download calendar invite (.ics)
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-500"
        />
        <span className="text-sm text-gray-700 font-medium">Create Zoom meeting</span>
      </label>

      {enabled && (
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="primary"
            size="small"
            onClick={handleCreate}
            loading={creating}
          >
            Create Zoom Meeting
          </Button>
          {error && <p className="text-xs text-york-500">{error}</p>}
        </div>
      )}
    </div>
  );
};
