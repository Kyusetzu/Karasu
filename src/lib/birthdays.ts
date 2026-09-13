/** Which favourites have their birthday on a given day; matching is exact, so a leap-day birthday skips common years. */

export interface BirthdayCandidate {
  dateOfBirth: { month: number | null; day: number | null } | null;
}

export function birthdaysOn<T extends BirthdayCandidate>(
  people: T[],
  month: number,
  day: number,
): T[] {
  return people.filter(
    (p) => p.dateOfBirth?.month === month && p.dateOfBirth?.day === day,
  );
}
