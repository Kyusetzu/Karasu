import { describe, expect, it } from "vitest";
import { birthdaysOn } from "./birthdays";

const person = (month: number | null, day: number | null, name = "x") => ({
  name,
  dateOfBirth: month === null && day === null ? null : { month, day },
});

describe("birthdaysOn", () => {
  it("matches month and day exactly", () => {
    const people = [person(8, 14, "today"), person(8, 15, "tomorrow"), person(7, 14, "lastMonth")];
    expect(birthdaysOn(people, 8, 14).map((p) => p.name)).toEqual(["today"]);
  });

  it("ignores people without a recorded birthday, whichever way absence is spelled", () => {
    const people = [person(null, null), person(8, null), person(null, 14)];
    expect(birthdaysOn(people, 8, 14)).toEqual([]);
  });

  it("a February 29th birthday matches only on February 29th", () => {
    const leap = [person(2, 29, "leapling")];
    expect(birthdaysOn(leap, 2, 29).map((p) => p.name)).toEqual(["leapling"]);
    expect(birthdaysOn(leap, 2, 28)).toEqual([]);
    expect(birthdaysOn(leap, 3, 1)).toEqual([]);
  });

  it("keeps the input order of a shared birthday", () => {
    const people = [person(1, 1, "first"), person(1, 1, "second")];
    expect(birthdaysOn(people, 1, 1).map((p) => p.name)).toEqual(["first", "second"]);
  });
});
