function getRoundForSlots(slotA, slotB) {

    let groupSize = 2;

    let round = 1;

    while (groupSize <= 128) {

        const groupA =
            Math.floor((slotA - 1) / groupSize);

        const groupB =
            Math.floor((slotB - 1) / groupSize);

        if (groupA === groupB) {
            return round;
        }

        groupSize *= 2;

        round++;
    }

    return null;
}


function getFirstPossibleMeetingRound(slotA, slotB) {

    if (!slotA || !slotB) {
        return null;
    }

    return getRoundForSlots(slotA, slotB);
}


function hasInstituteConflict(
    playerA,
    slotA,
    playerB,
    slotB,
    maximumRound
) {

    if (!playerA || !playerB) {
        return false;
    }

    if (!playerA.institute ||
        !playerB.institute) {

        return false;
    }

    if (
        playerA.institute.trim().toLowerCase() !==
        playerB.institute.trim().toLowerCase()
    ) {
        return false;
    }

    const meetingRound =
        getFirstPossibleMeetingRound(
            slotA,
            slotB
        );

    return meetingRound <= maximumRound;
}


function calculateInstitutePenalty(
    slots,
    maximumRound = 3
) {

    let penalty = 0;

    for (let i = 0; i < slots.length; i++) {

        if (!slots[i]) {
            continue;
        }

        for (
            let j = i + 1;
            j < slots.length;
            j++
        ) {

            if (!slots[j]) {
                continue;
            }

            const meetingRound =
                getFirstPossibleMeetingRound(
                    i + 1,
                    j + 1
                );

            if (meetingRound > maximumRound) {
                continue;
            }

            const sameInstitute =
                slots[i].institute
                    ?.trim()
                    .toLowerCase() ===
                slots[j].institute
                    ?.trim()
                    .toLowerCase();

            if (!sameInstitute) {
                continue;
            }

            // Heavy penalty for Round 1
            if (meetingRound === 1) {
                penalty += 1000;
            }

            // Medium penalty for Round 2
            else if (meetingRound === 2) {
                penalty += 100;
            }

            // Small penalty for Round 3
            else if (meetingRound === 3) {
                penalty += 10;
            }
        }
    }

    return penalty;
}


module.exports = {
    getFirstPossibleMeetingRound,
    hasInstituteConflict,
    calculateInstitutePenalty
};