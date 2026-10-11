import React from 'react';
import type { DriveLinkMetadata } from '../../types';
import { FileSpreadsheet, FileText, FileType, Folder, Image, Link, Presentation, type LucideIcon, X } from 'lucide-react';

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  doc:          FileText,
  sheet:        FileSpreadsheet,
  presentation: Presentation,
  pdf:          FileType,
  image:        Image,
  folder:       Folder,
  unknown:      Link,
};

const RESOURCE_LABELS: Record<string, string> = {
  doc:          'Google Doc',
  sheet:        'Google Sheet',
  presentation: 'Presentation',
  pdf:          'PDF',
  image:        'Image',
  folder:       'Drive Folder',
  unknown:      'Drive Link',
};

interface DrivePreviewProps {
  metadata: DriveLinkMetadata;
  showEmbed?: boolean;
  onRemove?: () => void;
  className?: string;
}

export const DrivePreview: React.FC<DrivePreviewProps> = ({
  metadata,
  showEmbed = false,
  onRemove,
  className = '',
}) => {
  const Icon = RESOURCE_ICONS[metadata.resource_type] ?? Link;
  const label = RESOURCE_LABELS[metadata.resource_type] ?? 'Drive Link';

  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden bg-white ${className}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-50 text-york-600 flex-shrink-0" aria-hidden><Icon className="w-4.5 h-4.5" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{metadata.title}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={metadata.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 text-xs font-medium text-york-600 border border-york-200 rounded hover:bg-york-50 transition-colors"
          >
            Open
          </a>
          {onRemove && (
            <button
              onClick={onRemove}
              aria-label="Remove link"
              className="p-1 text-gray-400 hover:text-york-500 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Embed preview (optional, for docs/sheets/PDFs) */}
      {showEmbed && metadata.embed_url && metadata.resource_type !== 'folder' && (
        <div className="border-t border-gray-100">
          <iframe
            src={metadata.embed_url}
            title={metadata.title}
            className="w-full h-64 border-0"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      )}
    </div>
  );
};
