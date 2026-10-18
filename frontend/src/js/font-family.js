/**
 * font-family.js
 *  Validation for the editor font family setting. The value is interpolated
 *  into innerHTML `style="..."` attributes (structures.js) and can come from
 *  an imported config file: only plain font names/stacks are accepted, so
 *  attribute breakout is impossible.
 */

export function isValidFontFamily(f) {
  return typeof f === 'string' && /^[\p{L}\p{N}\s,'-]+$/u.test(f);
}
