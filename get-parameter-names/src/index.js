/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const STRIP_PATTERN = /(static.*$)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|^\s*async(?:\s*|\()(?!\s*=)|\s/gm;

const DELIMITERS = new Set(['=', '(', ')', ',']);

/**
 * Parse a function and extract its parameter names
 * @param {Function | string} input - The function or function string to parse
 * @returns {string[]} Array of parameter names
 */
export function getParameterNames(input) {
    const cleaned = input.toString().replace(STRIP_PATTERN, '');

    let firstVar = true;
    let depthDefaultParams = 0;
    let depthParenthesis = 0;
    const vars = [];

    let buffer = '';
    let currentDelimiter = null;

    for (const char of cleaned) {
        if (DELIMITERS.has(char)) {
            // Process the segment
            const delimiter = currentDelimiter;
            const text = buffer;
            buffer = '';
            currentDelimiter = char;

            if (!delimiter) {
                if (text.length) vars.push(text);
            } else if (delimiter === '=') {
                if (text[0] === '>' && depthDefaultParams === 0) return vars;
                depthDefaultParams++;
            } else if (delimiter === ')') {
                if (depthParenthesis === 0) return vars;
                depthParenthesis--;
            } else if (delimiter === '(') {
                if (firstVar) {
                    vars.pop();
                    if (text.length) vars.push(text);
                    firstVar = false;
                } else if (vars.length) {
                    firstVar = true;
                    depthParenthesis++;
                } else if (depthParenthesis === 0) {
                    depthDefaultParams = 0;
                    vars.push(text);
                }
            } else if (delimiter === ',' && depthParenthesis === 0) {
                depthDefaultParams = 0;
                vars.push(text);
            }
        } else {
            buffer += char;
        }
    }

    return vars;
}
