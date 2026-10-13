import { Circle, Diamond, Hexagon, Square, Star, Triangle } from 'lucide-react';

const symbols = [
  { id: 'diamond', glyph: '◆', label: 'Diamond' },
  { id: 'circle', glyph: '●', label: 'Circle' },
  { id: 'triangle', glyph: '▲', label: 'Triangle' },
  { id: 'square', glyph: '■', label: 'Square' },
  { id: 'star', glyph: '★', label: 'Star' },
  { id: 'hexagon', glyph: '⬢', label: 'Hexagon' },
];

export const signalSymbols = symbols;

export function SignalGlyph({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const definition = symbols.find((item) => item.id === symbol || item.glyph === symbol);
  const common = { size, strokeWidth: 1.8, 'aria-hidden': true as const };
  if (definition?.id === 'circle') return <Circle {...common} />;
  if (definition?.id === 'square') return <Square {...common} />;
  if (definition?.id === 'diamond') return <Diamond {...common} />;
  if (definition?.id === 'star') return <Star {...common} />;
  if (definition?.id === 'hexagon') return <Hexagon {...common} />;
  return <Triangle {...common} />;
}
