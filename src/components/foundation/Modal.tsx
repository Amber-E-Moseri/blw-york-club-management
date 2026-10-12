import React, { useEffect, useRef, useCallback, useId } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'small' | 'medium' | 'large';
  closeButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

const sizeStyles: Record<NonNullable<ModalProps['size']>, string> = {
  small:  'max-w-[400px]',
  medium: 'max-w-[600px]',
  large:  'max-w-[800px]',
};

/** Focusable elements to trap focus within. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog/modal with focus trap, ESC key, backdrop, and portal rendering.
 *
 * @example
 * <Modal isOpen={open} onClose={handleClose} title="Add Contact">
 *   <ContactForm onSubmit={handleSubmit} />
 * </Modal>
 *
 * <Modal
 *   isOpen={confirmOpen}
 *   onClose={handleCancel}
 *   title="Confirm Delete?"
 *   size="small"
 *   footer={
 *     <>
 *       <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
 *       <Button variant="danger" onClick={handleDelete}>Delete</Button>
 *     </>
 *   }
 * >
 *   Are you sure you want to delete this contact?
 * </Modal>
 *
 * <Modal isOpen={open} onClose={onClose} title="Edit Profile" size="large">
 *   <ProfileForm />
 * </Modal>
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'medium',
  closeButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const titleId = `modal-title-${generatedId}`;

  // Focus trap
  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (!dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape' && closeOnEscape) {
      onClose();
    }
  }, [closeOnEscape, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', trapFocus);
    // Move focus into modal
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();
    // Prevent background scroll
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', trapFocus);
      document.body.style.overflow = '';
    };
  }, [isOpen, trapFocus]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-[fadeIn_0.2s_ease-out]"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div
        ref={dialogRef}
        className={cn(
          'relative w-full bg-white dark:bg-slate-900 rounded-lg shadow-xl',
          'flex flex-col max-h-[90vh]',
          'animate-[slideUp_0.25s_ease-out]',
          sizeStyles[size],
          className
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-slate-100 leading-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          {closeButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className={cn(
                'shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400',
                'hover:text-york-600 hover:bg-red-50 dark:hover:bg-slate-800 transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-york-600'
              )}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 flex items-center justify-end gap-3 px-5 py-3.5 border-t border-gray-100 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
