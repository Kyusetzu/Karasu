import { commands } from "./bindings";

/** The shape tauri-specta gives a command that returns a Rust `Result`. */
type Outcome<T, E> = { status: "ok"; data: T } | { status: "error"; error: E };

/** A unit `Result` arrives as `null`; callers read it as `void`, the way `invoke<void>` always did (`any` stays `any`). */
type Plain<T> = 0 extends 1 & T ? T : [T] extends [null] ? void : T;

/** Turns the generated `Result` back into a rejection carrying the Rust error string, which every catch here expects. */
export async function unwrap<T, E>(outcome: Promise<Outcome<T, E>>): Promise<Plain<T>> {
  const result = await outcome;
  if (result.status === "error") throw result.error;
  return result.data as Plain<T>;
}

export { commands };
