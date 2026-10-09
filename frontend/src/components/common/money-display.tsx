import React from 'react';

interface MoneyDisplayProps {
  paise: number;
  className?: string;
  sign?: boolean;
}

export const MoneyDisplay: React.FC<MoneyDisplayProps> = ({ paise, className = '', sign = false }) => {
  const rupees = (paise || 0) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(rupees));

  let display = formatted;
  if (sign && rupees > 0) {
    display = `+${formatted}`;
  } else if (sign && rupees < 0) {
    display = `-${formatted}`;
  }

  return <span className={`tabular-nums font-semibold ${className}`}>{display}</span>;
};
