/**
 * schedule.js
 * Generates a fantasy football regular season schedule.
 *
 * For the standard 10-team / 2-division configuration, uses the
 * hand-balanced template from Danny's original Python scheduler,
 * which guarantees 2x intra-division + balanced cross-division matchups.
 *
 * For other configurations, falls back to algorithmic round-robin.
 *
 * Matchup object shape: { away: string, home: string, type: 'div' | 'cross' }
 * Schedule shape: Array of weeks, each week is an array of matchup objects.
 */

/**
 * Main entry point. Routes to template or algorithmic generator.
 *
 * @param {Object} divisions - Output of generateDivisions()
 * @param {number} numWeeks - Number of regular season weeks
 * @returns {Array} - Array of week arrays, each containing matchup objects
 */
function buildSchedule(divisions, numWeeks) {
  const divEntries = Object.entries(divisions);
  const numDivs = divEntries.length;
  const divSize = divEntries[0][1].length;

  if (numDivs === 2 && divSize === 5) {
    return buildTemplate2Div5(divEntries, numWeeks);
  }

  return buildRoundRobinSchedule(divEntries, numWeeks);
}

/**
 * Hand-balanced 13-week template for 10 teams / 2 divisions (5 per div).
 * Ported directly from Danny's original Python schedule_generator().
 * Pattern: 2x intra-division, cross-division matchups for weeks 6-8.
 *
 * @param {Array} divEntries - [["Division A", [...]], ["Division B", [...]]]
 * @param {number} numWeeks - Slice to this many weeks (max 13)
 */
function buildTemplate2Div5(divEntries, numWeeks) {
  const [, A] = divEntries[0];
  const [, B] = divEntries[1];
  const [a1, a2, a3, a4, a5] = A;
  const [b1, b2, b3, b4, b5] = B;

  const template = [
    // Week 1 — intra-heavy
    [[a1,b2,'cross'],[a2,a3,'div'],[a4,a5,'div'],[b1,b5,'div'],[b3,b4,'div']],
    // Week 2
    [[a1,a4,'div'],[a2,b3,'cross'],[a3,a5,'div'],[b1,b4,'div'],[b2,b5,'div']],
    // Week 3
    [[a1,a5,'div'],[a2,a4,'div'],[a3,b4,'cross'],[b1,b2,'div'],[b3,b5,'div']],
    // Week 4
    [[a1,a3,'div'],[a2,a5,'div'],[a4,b5,'cross'],[b1,b3,'div'],[b2,b4,'div']],
    // Week 5
    [[a1,a2,'div'],[a3,a4,'div'],[a5,b1,'cross'],[b2,b3,'div'],[b4,b5,'div']],
    // Week 6 — full cross-division
    [[a1,b3,'cross'],[a2,b4,'cross'],[a3,b5,'cross'],[a4,b1,'cross'],[a5,b2,'cross']],
    // Week 7 — full cross-division (mirrored)
    [[a1,b1,'cross'],[a2,b2,'cross'],[a3,b3,'cross'],[a4,b4,'cross'],[a5,b5,'cross']],
    // Week 8 — full cross-division
    [[a1,b4,'cross'],[a2,b5,'cross'],[a3,b1,'cross'],[a4,b2,'cross'],[a5,b3,'cross']],
    // Week 9 — back to intra
    [[a1,a5,'div'],[a2,b1,'cross'],[a3,a4,'div'],[b2,b3,'div'],[b4,b5,'div']],
    // Week 10
    [[a1,a4,'div'],[a2,a5,'div'],[a3,b2,'cross'],[b1,b4,'div'],[b3,b5,'div']],
    // Week 11
    [[a1,a2,'div'],[a3,a5,'div'],[a4,b3,'cross'],[b1,b5,'div'],[b2,b4,'div']],
    // Week 12
    [[a1,a3,'div'],[a2,a4,'div'],[a5,b4,'cross'],[b1,b3,'div'],[b2,b5,'div']],
    // Week 13
    [[a1,b5,'cross'],[a2,a3,'div'],[a4,a5,'div'],[b1,b2,'div'],[b3,b4,'div']],
  ];

  return template.slice(0, numWeeks).map(week =>
    week.map(([away, home, type]) => ({ away, home, type }))
  );
}

/**
 * Generic round-robin schedule for non-standard configurations.
 * Attempts to balance intra-division vs cross-division matchups.
 */
function buildRoundRobinSchedule(divEntries, numWeeks) {
  const schedule = [];
  const allTeams = divEntries.flatMap(([, teams]) => teams);

  // Build a division lookup for tagging matchup type
  const teamDiv = {};
  divEntries.forEach(([name, teams]) => teams.forEach(t => (teamDiv[t] = name)));

  // Generate round-robin rotation for all teams
  const rotationRounds = roundRobinRounds(allTeams);

  for (let w = 0; w < numWeeks; w++) {
    const round = rotationRounds[w % rotationRounds.length];
    const week = round.map(([away, home]) => ({
      away,
      home,
      type: teamDiv[away] === teamDiv[home] ? 'div' : 'cross',
    }));
    schedule.push(week);
  }

  return schedule;
}

/**
 * Standard round-robin rotation algorithm.
 * Returns all possible rounds (n-1 rounds for n teams).
 */
function roundRobinRounds(teams) {
  const list = teams.length % 2 === 0 ? [...teams] : [...teams, 'BYE'];
  const n = list.length;
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== 'BYE' && b !== 'BYE') round.push([a, b]);
    }
    rounds.push(round);
    // Rotate: fix position 0, rotate the rest
    list.splice(1, 0, list.pop());
  }

  return rounds;
}

/**
 * Generate the rivalry week matchup based on last season's division standings.
 * Rank 1 of Div A plays Rank 1 of Div B, rank 2 plays rank 2, etc.
 *
 * @param {Object} divisions - Current season divisions { "Division A": [...], ... }
 * @param {Object} lastSeasonRankings - { "Division A": ["Team1","Team2",...], ... }
 *   Teams ordered 1st to last within each division.
 * @returns {Array} - Array of matchup objects for rivalry week
 */
function buildRivalryWeek(divisions, lastSeasonRankings) {
  const divNames = Object.keys(lastSeasonRankings);
  if (divNames.length < 2) return [];

  const [divA, divB] = divNames;
  const rankingsA = lastSeasonRankings[divA];
  const rankingsB = lastSeasonRankings[divB];
  const len = Math.min(rankingsA.length, rankingsB.length);

  const matchups = [];
  for (let i = 0; i < len; i++) {
    matchups.push({
      away: rankingsA[i],
      home: rankingsB[i],
      type: 'rivalry',
      label: `#${i + 1} seed`,
    });
  }

  return matchups;
}
