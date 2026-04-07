import { useState } from 'react';

const PRESET_COLORS = [
  '#FF6B6B','#FF6B9D','#FF9100','#FFD700','#00C851',
  '#00BCD4','#6C63FF','#FF1744','#E91E63','#9C27B0',
  '#2196F3','#00BFA5','#FF5722','#795548','#607D8B',
  '#FFEB3B','#8BC34A','#03A9F4','#FF4081','#7C4DFF',
];

export default function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value || '#FF6B6B');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-14 h-14 rounded-2xl border-3 border-black shadow-[3px_3px_0px_black] hover:scale-105 transition-transform"
        style={{ backgroundColor: value || '#FF6B6B' }}
      />
      {open && (
        <div className="absolute z-50 top-16 left-0 bg-white border-3 border-black rounded-3xl shadow-[5px_5px_0px_black] p-4 w-64">
          <p className="text-xs font-black mb-2 uppercase">Pick a color</p>
          <div className="grid grid-cols-5 gap-2 mb-3">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className={`w-9 h-9 rounded-xl border-2 hover:scale-110 transition-transform ${value === c ? 'border-black border-3' : 'border-gray-300'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              className="w-10 h-10 rounded-lg border-2 border-black cursor-pointer"
            />
            <input
              type="text"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              className="flex-1 border-2 border-black rounded-xl px-2 py-1 text-sm font-mono"
              maxLength={7}
            />
            <button
              type="button"
              onClick={() => { onChange(custom); setOpen(false); }}
              className="bg-black text-white text-xs font-black px-3 py-1 rounded-xl"
            >OK</button>
          </div>
        </div>
      )}
    </div>
  );
}