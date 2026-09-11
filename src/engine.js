export function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function validateExchangeInput(participants, exclusions) {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error("Add at least two participants.");
  }

  if (participants.length > 100) {
    throw new Error("Exchanges are limited to 100 participants.");
  }

  const names = participants.map((name) => String(name).trim().replace(/\s+/g, " "));
  if (names.some((name) => name.length < 2 || name.length > 80)) {
    throw new Error("Each full name must be between 2 and 80 characters.");
  }

  const keys = names.map(normalizeName);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Each participant must have a unique full name.");
  }

  const known = new Set(keys);
  const normalizedExclusions = [];
  const seen = new Set();

  for (const exclusion of Array.isArray(exclusions) ? exclusions : []) {
    const giver = normalizeName(String(exclusion.giver ?? ""));
    const recipient = normalizeName(String(exclusion.recipient ?? ""));
    if (!known.has(giver) || !known.has(recipient)) {
      throw new Error("Every exclusion must reference a current participant.");
    }
    if (giver === recipient) continue;
    const key = `${giver}\u0000${recipient}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalizedExclusions.push({ giver, recipient });
    }
  }

  return { names, keys, exclusions: normalizedExclusions };
}

export function findCircularOrder(names, exclusions, random = Math.random) {
  const keys = names.map(normalizeName);
  const blocked = new Set(
    exclusions.map(({ giver, recipient }) => `${normalizeName(giver)}\u0000${normalizeName(recipient)}`),
  );
  const allowed = (from, to) =>
    from !== to && !blocked.has(`${keys[from]}\u0000${keys[to]}`);

  const outgoing = keys.map((_, from) =>
    shuffled(
      keys.map((__, index) => index).filter((to) => allowed(from, to)),
      random,
    ),
  );

  if (outgoing.some((choices) => choices.length === 0)) return null;

  const starts = shuffled(keys.map((_, index) => index), random);
  for (const start of starts) {
    const path = [start];
    const used = new Set(path);
    if (search(path, used, start, outgoing)) {
      return path.map((index) => names[index]);
    }
  }
  return null;
}

function search(path, used, start, outgoing) {
  if (path.length === outgoing.length) {
    return outgoing[path.at(-1)].includes(start);
  }

  const current = path.at(-1);
  const candidates = outgoing[current]
    .filter((next) => !used.has(next))
    .sort((a, b) => remainingChoices(a, used, outgoing) - remainingChoices(b, used, outgoing));

  for (const next of candidates) {
    if (path.length === outgoing.length - 1 && !outgoing[next].includes(start)) continue;
    used.add(next);
    path.push(next);
    if (search(path, used, start, outgoing)) return true;
    path.pop();
    used.delete(next);
  }
  return false;
}

function remainingChoices(index, used, outgoing) {
  return outgoing[index].reduce((count, next) => count + Number(!used.has(next)), 0);
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}
