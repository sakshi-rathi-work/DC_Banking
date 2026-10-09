import React from 'react';

interface NodeBadgeProps {
  nodeId: number;
  className?: string;
  showPrefix?: boolean;
}

export const NodeBadge: React.FC<NodeBadgeProps> = ({ nodeId, className = '', showPrefix = true }) => {
  let colors = 'bg-slate-800 text-slate-300 border-slate-700';
  if (nodeId === 1) colors = 'bg-sky-950/80 text-sky-400 border-sky-800';
  else if (nodeId === 2) colors = 'bg-violet-950/80 text-violet-400 border-violet-800';
  else if (nodeId === 3) colors = 'bg-amber-950/80 text-amber-400 border-amber-800';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${colors} ${className}`}
    >
      {showPrefix ? `Node ${nodeId}` : nodeId}
    </span>
  );
};
