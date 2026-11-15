function validatePlayers(players) {
    const errors = [];
    const warnings = [];

    // --------------------------------------------------
    // 1. Check player count
    // --------------------------------------------------

    if (players.length < 2) {
        errors.push("At least two players are required.");
    }

    if (players.length > 128) {
        errors.push(
            `Maximum 128 players are allowed. Found ${players.length}.`
        );
    }

    // --------------------------------------------------
    // 2. Check player names
    // --------------------------------------------------

    players.forEach((player, index) => {

        const rowNumber = player.rowNumber || index + 2;

        if (!player.name || player.name.trim() === "") {
            errors.push(
                `Player name is missing at row ${rowNumber}.`
            );
        }
    });

    // --------------------------------------------------
    // 3. Check institutes
    // --------------------------------------------------

    players.forEach((player, index) => {

        const rowNumber = player.rowNumber || index + 2;

        if (!player.institute || player.institute.trim() === "") {
            errors.push(
                `Institute is missing for ${player.name || `row ${rowNumber}`}.`
            );
        }
    });

    // --------------------------------------------------
    // 4. Check seeds
    // --------------------------------------------------

    const usedSeeds = new Set();

    players.forEach((player, index) => {

        const rowNumber = index + 2;

        if (player.seed === null || player.seed === undefined) {
            return;
        }

        // Seed must be a number
        if (!Number.isInteger(player.seed)) {
            errors.push(
                `Invalid seed for ${player.name}: ${player.seed}`
            );
            return;
        }

        // Seed must be positive
        if (player.seed <= 0) {
            errors.push(
                `Seed must be greater than 0 for ${player.name}.`
            );
        }

        // Seed cannot exceed player count
        if (player.seed > players.length) {
            errors.push(
                `Seed ${player.seed} for ${player.name} is invalid.`
            );
        }

        // Duplicate seed
        if (usedSeeds.has(player.seed)) {
            errors.push(
                `Duplicate seed number: ${player.seed}`
            );
        }

        usedSeeds.add(player.seed);
    });

    // --------------------------------------------------
    // 5. Check seed count
    // --------------------------------------------------

    const seededPlayers =
        players.filter(player => player.seed != null);

    if (seededPlayers.length === 0) {
        warnings.push(
            "No seeded players found."
        );
    }

    // --------------------------------------------------
    // Return validation result
    // --------------------------------------------------

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        playerCount: players.length,
        seededCount: seededPlayers.length,
        unseededCount:
            players.length - seededPlayers.length
    };
}

module.exports = {
    validatePlayers
};