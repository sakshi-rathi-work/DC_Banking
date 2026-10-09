import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmButtonProps {
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  label: string;
  variant?: 'danger' | 'warning' | 'primary';
  disabled?: boolean;
  className?: string;
}

export const ConfirmButton: React.FC<ConfirmButtonProps> = ({
  onConfirm,
  title,
  description,
  label,
  variant = 'danger',
  disabled = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const btnColors =
    variant === 'danger'
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : variant === 'warning'
      ? 'bg-amber-600 hover:bg-amber-500 text-white'
      : 'bg-indigo-600 hover:bg-indigo-500 text-white';

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${btnColors} ${className}`}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-semibold text-white">{title}</h3>
            </div>
            {description && <p className="text-sm text-slate-400 mb-6">{description}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirm}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${btnColors} disabled:opacity-50`}
              >
                {loading ? 'Executing...' : 'Confirm Action'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
