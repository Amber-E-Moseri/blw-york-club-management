import React, { useState } from 'react';
import { useDriveLink } from '../../hooks/useDriveLink';
import { DrivePreview } from './DrivePreview';
import { AlertCircle } from 'lucide-react';

interface DriveLinkInputProps {
  initialUrl?: string;
  onSave?: (url: string) => void;
  onRemove?: () => void;
  label?: string;
  placeholder?: string;
  showEmbed?: boolean;
  className?: string;
}

export const DriveLinkInput: React.FC<DriveLinkInputProps> = ({
  initialUrl,
  onSave,
  onRemove,
  label = 'Google Drive Link',
  placeholder = 'Paste a Google Drive or Docs URL…',
  showEmbed = false,
  className = '',
}) => {
  const [inputValue, setInputValue] = useState(initialUrl ?? '');
  const { metadata, error, setUrl } = useDriveLink(initialUrl);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setUrl(val);
  };

  const handleSave = () => {
    if (metadata && onSave) onSave(metadata.url);
  };

  const handleRemove = () => {
    setInputValue('');
    setUrl('');
    onRemove?.();
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className="block text-sm font-semibold text-gray-900 dark:text-slate-100">{label}</label>
      )}

      {/* Show preview when we have valid metadata; show input otherwise */}
      {metadata ? (
        <DrivePreview
          metadata={metadata}
          showEmbed={showEmbed}
          onRemove={handleRemove}
        />
      ) : (
        <>
          <input
            type="url"
            value={inputValue}
            onChange={handleChange}
            placeholder={placeholder}
            className={`w-full px-3 py-2.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-york-600 focus:border-transparent transition-all ${
              error ? 'border-york-400 bg-york-50 dark:bg-york-900/30' : 'border-gray-200 dark:border-slate-700'
            }`}
          />
          {error && (
            <p className="text-xs text-york-600 dark:text-york-400"><AlertCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />{error}</p>
          )}
        </>
      )}

      {/* Save button — only shown when URL is valid and not yet saved */}
      {metadata && onSave && (
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-medium bg-york-600 text-white rounded-md hover:bg-york-700 transition-colors"
        >
          Attach link
        </button>
      )}

      <p className="text-xs text-gray-400 dark:text-slate-400">
        Supports Google Docs, Sheets, Slides, PDFs, and Drive folders.
        Make sure sharing is set to "Anyone with the link."
      </p>
    </div>
  );
};
