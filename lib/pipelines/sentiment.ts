/**
 * Sentiment.
 *
 * Fifty-two places in the console read a sentiment figure and, until this
 * module existed, nothing wrote one outside the seed — which meant the
 * "sentiment drops below −0.40" escalation trigger could never fire on a real
 * conversation. A guardrail that silently cannot trigger is worse than no
 * guardrail, because the Tuning screen lists it as protection.
 *
 * Two readings, deliberately different:
 *
 *   `scoreUtterance`  a lexicon, run inline on every customer turn
 *   `scoreConversation`  the model, run once when the conversation closes
 *
 * The split is a latency decision. The trigger is checked *before* generation,
 * so anything on that path is added to the caller's wait — and on a phone call
 * we have about 300ms of silence before it is audible. A model call there
 * would cost seconds. The lexicon costs microseconds and is directionally
 * right, which is all a threshold needs; the model then corrects the record
 * afterwards, off the critical path.
 */

/**
 * Words that move a support conversation, weighted by how strongly.
 *
 * Tuned for the domain rather than general English: "cancel" and "refund" are
 * mild in ordinary text and severe on a helpline, and "fine" is usually a
 * complaint rather than an endorsement.
 */
const NEGATIVE: Record<string, number> = {
  cancel: 0.5, cancelling: 0.55, cancelled: 0.4, refund: 0.3, complaint: 0.5,
  complain: 0.45, solicitor: 0.7, ombudsman: 0.7, lawyer: 0.6, legal: 0.4,
  unacceptable: 0.6, ridiculous: 0.6, appalling: 0.7, disgusted: 0.7,
  furious: 0.7, angry: 0.55, annoyed: 0.4, frustrated: 0.5, frustrating: 0.5,
  useless: 0.55, terrible: 0.55, awful: 0.55, worst: 0.5, disappointed: 0.45,
  disappointing: 0.45, wrong: 0.3, failed: 0.4, failure: 0.4, broken: 0.35,
  damaged: 0.35, late: 0.3, delayed: 0.3, missed: 0.35, again: 0.25,
  still: 0.2, never: 0.3, nobody: 0.35, waiting: 0.25, waited: 0.3,
  ignored: 0.5, rude: 0.55, hopeless: 0.5, "fed up": 0.6, "sick of": 0.6,
  "third time": 0.5, "day off": 0.35, escalate: 0.4, manager: 0.25,
};

const POSITIVE: Record<string, number> = {
  thanks: 0.4, thank: 0.4, thankyou: 0.45, "thank you": 0.45, great: 0.45,
  perfect: 0.55, brilliant: 0.55, excellent: 0.55, lovely: 0.45, wonderful: 0.5,
  helpful: 0.5, appreciate: 0.5, appreciated: 0.5, pleased: 0.45, happy: 0.45,
  good: 0.3, fine: 0.15, sorted: 0.4, resolved: 0.4, "no problem": 0.35,
  fantastic: 0.55, marvellous: 0.5, "well done": 0.5,
};

/** Words that flip or soften whatever follows. */
const NEGATORS = ["not", "no", "never", "isn't", "wasn't", "don't", "didn't", "can't", "won't"];

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Score one utterance from −1 to 1.
 *
 * Not a classifier — a thermometer. It exists to answer "is this going badly
 * enough to hand over", and it is checked against a threshold, never shown to
 * anyone as a precise figure.
 */
export function scoreUtterance(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ")} `;
  const words = lower.trim().split(" ");

  let score = 0;
  let hits = 0;

  const apply = (table: Record<string, number>, sign: number) => {
    for (const [term, weight] of Object.entries(table)) {
      if (!lower.includes(` ${term} `) && !lower.includes(term)) continue;
      const index = words.indexOf(term.split(" ")[0]);
      // "not great" should not read as praise.
      const negated =
        index > 0 && NEGATORS.includes(words[index - 1]);
      score += (negated ? -sign : sign) * weight;
      hits++;
    }
  };

  apply(NEGATIVE, -1);
  apply(POSITIVE, 1);

  // Shouting is its own signal.
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) score -= 0.3;
  if ((text.match(/!/g) ?? []).length >= 2) score -= 0.15;

  if (hits === 0) return 0;
  // Compress so a pile-up of mild words cannot reach the extremes reserved for
  // genuinely severe language. Rounded to two places like every other reading,
  // so a turn and its conversation cannot print different numbers.
  return round(Math.max(-1, Math.min(1, Math.tanh(score / 1.4))));
}

/**
 * The running sentiment of a conversation.
 *
 * Weighted towards the most recent utterance, because a call that started
 * badly and has been recovered should not keep escalating — and one that has
 * just turned should escalate immediately.
 */
export function runningSentiment(utterances: string[]): number | null {
  if (utterances.length === 0) return null;
  const scored = utterances.map(scoreUtterance);
  const latest = scored.at(-1)!;
  if (scored.length === 1) return round(latest);

  const history = scored.slice(0, -1);
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  return round(latest * 0.65 + mean * 0.35);
}

