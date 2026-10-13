export const SYMBOLS = ["◆", "●", "▲", "■", "★", "⬢"] as const;

export type SignalSymbol = (typeof SYMBOLS)[number];

const SYMBOL_NAMES: Record<SignalSymbol, string> = {
  "◆": "diamond",
  "●": "circle",
  "▲": "triangle",
  "■": "square",
  "★": "star",
  "⬢": "hexagon",
};

export type PuzzleClue =
  | {
      id: string;
      kind: "position";
      position: number;
      symbol: SignalSymbol;
      text: string;
    }
  | {
      id: string;
      kind: "included" | "excluded";
      symbol: SignalSymbol;
      text: string;
    };

export interface GeneratedPuzzle {
  answer: SignalSymbol[];
  cluesByPlayer: Record<string, PuzzleClue[]>;
  allClues: PuzzleClue[];
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function createClues(answer: readonly SignalSymbol[]): PuzzleClue[] {
  const positionClues: PuzzleClue[] = answer.map((symbol, position) => ({
    id: `position-${position + 1}`,
    kind: "position",
    position,
    symbol,
    text: `Position ${position + 1} carries the ${SYMBOL_NAMES[symbol]} ${symbol}.`,
  }));

  const membershipClues: PuzzleClue[] = SYMBOLS.map((symbol) => {
    const included = answer.includes(symbol);

    return {
      id: `membership-${symbol}`,
      kind: included ? "included" : "excluded",
      symbol,
      text: included
        ? `The ${SYMBOL_NAMES[symbol]} ${symbol} is in the signal.`
        : `The ${SYMBOL_NAMES[symbol]} ${symbol} is not in the signal.`,
    };
  });

  return [...positionClues, ...membershipClues];
}

function matchesClue(
  sequence: readonly SignalSymbol[],
  clue: PuzzleClue,
): boolean {
  if (clue.kind === "position") {
    return sequence[clue.position] === clue.symbol;
  }

  const included = sequence.includes(clue.symbol);
  return clue.kind === "included" ? included : !included;
}

export function solveClues(clues: readonly PuzzleClue[]): SignalSymbol[][] {
  const solutions: SignalSymbol[][] = [];

  function visit(sequence: SignalSymbol[]): void {
    if (sequence.length === 4) {
      if (clues.every((clue) => matchesClue(sequence, clue))) {
        solutions.push([...sequence]);
      }
      return;
    }

    for (const symbol of SYMBOLS) {
      if (!sequence.includes(symbol)) {
        sequence.push(symbol);
        visit(sequence);
        sequence.pop();
      }
    }
  }

  visit([]);
  return solutions;
}

export function generatePuzzle(
  playerIds: readonly string[],
  random: () => number = Math.random,
): GeneratedPuzzle {
  if (playerIds.length < 2 || playerIds.length > 6) {
    throw new Error("A puzzle requires 2–6 players.");
  }

  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("Player IDs must be unique.");
  }

  const answer = shuffled(SYMBOLS, random).slice(0, 4);
  const allClues = shuffled(createClues(answer), random);
  const playerOrder = shuffled(playerIds, random);
  const cluesByPlayer: Record<string, PuzzleClue[]> = Object.fromEntries(
    playerIds.map((playerId) => [playerId, []]),
  );

  allClues.forEach((clue, index) => {
    const playerId = playerOrder[index % playerOrder.length];
    cluesByPlayer[playerId].push(clue);
  });

  const solutions = solveClues(allClues);
  if (
    solutions.length !== 1 ||
    solutions[0].some((symbol, index) => symbol !== answer[index])
  ) {
    throw new Error("Generated clues do not uniquely identify the answer.");
  }

  return { answer, cluesByPlayer, allClues };
}
