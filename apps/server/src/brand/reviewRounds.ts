import type { BrandReviewRoundInput, BrandReviewSeat } from "@moonfold/contracts";

const round2 = (value: number) => Math.round(value * 100) / 100;
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();

/**
 * Seats, averages and the Markdown summary of a kit's review rounds. A reviewer keeps the seat
 * of their first round, so a council glyph means the same reviewer all the way down (D-67).
 */
export function summarizeReviewRounds(rounds: ReadonlyArray<BrandReviewRoundInput>) {
  const seats: Array<BrandReviewSeat> = [];
  const seatOf = (reviewer: string) => {
    const key = reviewer.trim().toLowerCase();
    const found = seats.find((seat) => seat.reviewer.trim().toLowerCase() === key);
    if (found !== undefined) return found.seat;
    const seat = seats.length + 1;
    seats.push({ seat, reviewer });
    return seat;
  };
  const averages = rounds.map((round) => {
    for (const score of round.scores) seatOf(score.reviewer);
    const total = round.scores.reduce((sum, score) => sum + score.score, 0);
    return { round: round.round, average: round2(total / round.scores.length) };
  });
  const glyph = (seat: number) => `![Seat ${seat}](seats/seat-${seat}.svg)`;
  const lines = [
    "# Review rounds",
    "",
    "Each reviewer keeps one seat and one glyph for every round.",
    "",
    "| Seat | Glyph | Reviewer |",
    "| ---- | ----- | -------- |",
    ...seats.map((seat) => `| ${seat.seat} | ${glyph(seat.seat)} | ${cell(seat.reviewer)} |`),
  ];
  for (const round of rounds.toReversed()) {
    const average = averages.find((entry) => entry.round === round.round)!.average;
    lines.push("", `## Round ${round.round}: ${average} / 10`, "");
    lines.push("| Seat | Glyph | Score | Fixes |", "| ---- | ----- | ----- | ----- |");
    for (const score of round.scores) {
      const seat = seatOf(score.reviewer);
      const fixes = score.fixes.length === 0 ? "None" : score.fixes.map(cell).join("<br>");
      lines.push(`| ${seat} | ${glyph(seat)} | ${round2(score.score)} | ${fixes} |`);
    }
  }
  if (seats.length === 1) {
    lines.push("", "One reviewer only: scores from a single provider are a weaker check.");
  }
  return { seats, averages, markdown: `${lines.join("\n")}\n` };
}
