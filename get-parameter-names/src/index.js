/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

// Match static as a whole token; JavaScript identifiers also allow $, Unicode, and joiners.
const STRIP_PATTERN = /(?<![$\p{ID_Continue}\u200c\u200d])static(?![$\p{ID_Continue}\u200c\u200d]).*$|^\s*async(?:\s*|\()(?!\s*=)|\s/gmu;

const LITERALS_AND_COMMENTS = /\/\/.*|\/\*[\s\S]*?\*\/|(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g;

/**
 * Parse a function and extract its parameter names
 * @param {Function | string} input - The function or function string to parse
 * @returns {string[]} Array of parameter names
 */
export function getParameterNames(input) {
    // Mask literals and remove comments before reading delimiters.
    const cleaned = input
        .toString()
        .replace(LITERALS_AND_COMMENTS, token => (token[0] === '/' ? '' : '0'))
        .replace(STRIP_PATTERN, '');

    const opening = cleaned.indexOf('(');
    const arrow = cleaned.indexOf('=>');
    if (arrow !== -1 && (opening === -1 || arrow < opening)) {
        return [cleaned.slice(0, arrow)];
    }
    if (opening === -1) return [];

    let depth = 0;
    let inDefault = false;
    let name = '';
    const vars = [];

    for (const char of cleaned.slice(opening + 1)) {
        // Only top-level commas separate parameters; nested expressions belong to defaults.
        if (depth === 0) {
            if (char === ')') {
                if (name || inDefault) vars.push(name);
                break;
            }
            if (char === ',') {
                vars.push(name);
                name = '';
                inDefault = false;
                continue;
            }
            if (char === '=') {
                inDefault = true;
                continue;
            }
        }
        if ('([{'.includes(char)) depth++;
        else if (')]}'.includes(char)) depth--;
        else if (depth === 0 && !inDefault) name += char;
    }

    return vars;
}
