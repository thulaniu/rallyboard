const { calculateInstitutePenalty } = require("./instituteBalancer");

function getBracketSize(playerCount) {
    const size = [8, 16, 32, 64, 128].find(value => value >= playerCount);
    if (!size) throw new Error("Maximum tournament size is 128 players.");
    return size;
}

function generateBracketPositions(bracketSize) {
    let positions = [1, 2];
    for (let size = 4; size <= bracketSize; size *= 2) {
        positions = positions.flatMap(position => [position, size + 1 - position]);
    }
    return positions;
}

function shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function createCandidate(players, bracketSize, positions) {
    const slots = Array(bracketSize).fill(null);
    const reserved = new Set();
    const seeds = players.filter(player => player.seed != null).sort((a, b) => a.seed - b.seed);
    const unseeded = shuffle(players.filter(player => player.seed == null));
    for (const player of seeds) {
        const index = positions.indexOf(player.seed);
        if (index < 0 || slots[index]) throw new Error(`Unable to place seed ${player.seed}.`);
        slots[index] = player;
    }

    let byes = bracketSize - players.length;
    for (const player of seeds) {
        const index = positions.indexOf(player.seed);
        const opponent = index ^ 1;
        if (byes && !slots[opponent] && !reserved.has(opponent)) {
            reserved.add(opponent);
            byes--;
        }
    }
    const emptyPairs = shuffle(Array.from({ length: bracketSize / 2 }, (_, index) => index * 2)
        .filter(index => !slots[index] && !slots[index + 1]));
    for (const index of emptyPairs) {
        if (!byes) break;
        reserved.add(index + (Math.random() < 0.5 ? 0 : 1));
        byes--;
    }
    for (const index of shuffle(Array.from({ length: bracketSize }, (_, i) => i))) {
        if (!byes) break;
        if (!slots[index] && !reserved.has(index)) {
            reserved.add(index);
            byes--;
        }
    }
    const available = shuffle(Array.from({ length: bracketSize }, (_, i) => i)
        .filter(index => !slots[index] && !reserved.has(index)));
    unseeded.forEach((player, index) => { slots[available[index]] = player; });
    return slots;
}

function optimizeInstituteBalance(players, bracketSize, positions) {
    let slots;
    let penalty = Infinity;
    for (let attempt = 0; attempt < 400; attempt++) {
        const candidate = createCandidate(players, bracketSize, positions);
        const score = calculateInstitutePenalty(candidate, 3);
        if (score < penalty) {
            slots = candidate;
            penalty = score;
        }
        if (penalty === 0) break;
    }
    return { slots, penalty };
}

function createSeededBracket(players) {
    const bracketSize = getBracketSize(players.length);
    const positions = generateBracketPositions(bracketSize);
    const result = optimizeInstituteBalance(players, bracketSize, positions);
    return { bracketSize, positions, slots: result.slots, institutePenalty: result.penalty };
}

module.exports = { getBracketSize, generateBracketPositions, createSeededBracket, optimizeInstituteBalance };
