import React from 'react';

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ onMouseDown }) => (
  <div
    onMouseDown={onMouseDown}
    className="w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-purple-500/50 active:bg-purple-500/70 transition-colors"
  />
);
