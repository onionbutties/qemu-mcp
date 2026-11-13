/**
 * Sample macro. Macros are ESM modules exporting a default async function
 * with the shape `(session, args) => result`.
 *
 * @param {object} session - VM session passed to the macro.
 * @param {object} [args] - Caller-supplied arguments.
 * @returns {Promise<{ ok: boolean }>}
 */
export default async function dosPrompt(session, args) {
  return { ok: true };
}
