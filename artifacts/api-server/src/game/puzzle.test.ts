import assert from "node:assert/strict";
import test from "node:test";
import { generatePuzzle, solveClues, SYMBOLS } from "./puzzle";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("generated answers contain four distinct symbols from the six-symbol set", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const { answer } = generatePuzzle(["a", "b"], seededRandom(seed));

    assert.equal(answer.length, 4);
    assert.equal(new Set(answer).size, 4);
    assert.ok(answer.every((symbol) => SYMBOLS.includes(symbol)));
  }
});

test("all private clues combine to exactly one answer for every supported team size", () => {
  for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
    const playerIds = Array.from(
      { length: playerCount },
      (_value, index) => `player-${index + 1}`,
    );

    for (let seed = 1; seed <= 100; seed += 1) {
      const puzzle = generatePuzzle(playerIds, seededRandom(seed * playerCount));
      const distributedClues = Object.values(puzzle.cluesByPlayer).flat();
      const solutions = solveClues(distributedClues);

      assert.equal(distributedClues.length, puzzle.allClues.length);
      assert.ok(
        Object.values(puzzle.cluesByPlayer).every((clues) => clues.length > 0),
      );
      assert.equal(solutions.length, 1);
      assert.deepEqual(solutions[0], puzzle.answer);
    }
  }
});

test("puzzle generation rejects unsupported team sizes and duplicate IDs", () => {
  assert.throws(() => generatePuzzle(["only-player"]), /2–6 players/u);
  assert.throws(
    () => generatePuzzle(["player", "player"]),
    /unique/u,
  );
  assert.throws(
    () =>
      generatePuzzle(
        ["1", "2", "3", "4", "5", "6", "7"],
        seededRandom(7),
      ),
    /2–6 players/u,
  );
});
