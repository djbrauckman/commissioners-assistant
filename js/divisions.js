/**
 * divisions.js
 * Ported from Danny's original Python division randomizer.
 * Generates randomized divisions from a flat list of team names.
 */

const DIV_COLORS = ['#1D9E75', '#185FA5', '#BA7517', '#993556'];

/**
 * Shuffle an array in place using Fisher-Yates.
 * Equivalent to random.shuffle() in Python.
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate randomized divisions from a list of team names.
 * Equivalent to the original Python generate_divisions().
 *
 * @param {string[]} members - Flat list of team names
 * @param {number} numDivisions - Number of divisions (default: 2)
 * @returns {Object} - { "Division A": [...], "Division B": [...], ... }
 */
function generateDivisions(members, numDivisions = 2) {
  if (members.length % numDivisions !== 0) {
    throw new Error(
      `Can't evenly split ${members.length} members into ${numDivisions} divisions`
    );
  }

  const shuffled = shuffleArray(members);
  const size = Math.floor(shuffled.length / numDivisions);
  const divisions = {};

  for (let i = 0; i < numDivisions; i++) {
    const letter = String.fromCharCode(65 + i); // 65 = 'A'
    divisions[`Division ${letter}`] = shuffled.slice(i * size, (i + 1) * size);
  }

  return divisions;
}
