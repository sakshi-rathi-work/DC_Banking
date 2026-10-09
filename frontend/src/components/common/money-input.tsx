import React, { useState } from 'react';

interface MoneyInputProps {
  valuePaise: number;
  onChangePaise: (paise: number) => void;
  placeholder?: string;
  minRupees?: number;
  maxRupees?: number;
  disabled?: boolean;
  className?: string;
}

export const MoneyInput: React.FC<MoneyInputProps> = ({
  valuePaise,
  onChangePaise,
  placeholder = '0.00',
  disabled = false,
  className = '',
}) => {
  const [text, setText] = useState<string>(valuePaise ? String(valuePaise / 100) : '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^\d+(\.\d{0,2})?$/.test(val)) {
      setText(val);
      const num = parseFloat(val);
      if (!isNaN(num)) {
        onChangePaise(Math.round(num * 100));
      } else {
        onChangePaise(0);
      }
    }
  };

  return (
    <div className={`relative rounded-lg shadow-sm ${className}`}>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <span className="text-slate-400 font-semibold text-lg">₹</span>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className="block w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-8 pr-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-lg tabular-nums transition disabled:opacity-50"
      />
    </div>
  );
};
