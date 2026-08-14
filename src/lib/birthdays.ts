/**
 * Which favourites have their birthday on a given day.
 *
 * Pure on purpose: the dashboard hands in today's month/day from the local
 * clock, so "whose birthday is it" is testable without a clock. Matching is
 * exact — a February 29th birthday simply does not come up in a common year,
 * which is at least honest; sliding it to March 1st would be a guess the
 * person never made.
 */

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
