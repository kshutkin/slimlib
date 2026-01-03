/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const STRIP_PATTERN = /(static.*$)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|^\s*async(?:\s*|\()(?!\s*=)|\s/gm;

const nonVarChars = ['=', '(', ')', ','];

/**
 * Generator function that yields segments with delimiter information
 * @param {string} string - The string to parse
 * @returns {Generator<[string|null, string], void, undefined>}
 */
function* matchNexter(string) {
    const delimiters = new Set(nonVarChars);
    let buffer = '';
    let currentDelimiter = null;

    for (const char of string) {
        if (delimiters.has(char)) {
            yield [currentDelimiter, buffer];
            buffer = '';
            currentDelimiter = char;
        } else {
            buffer += char;
        }
    }

    if (buffer) {
        yield [currentDelimiter, buffer];
    }
}

/**
 * Parse a function and extract its parameter names
 * @param {Function | string} input - The function or function string to parse
 * @returns {string[]} Array of parameter names
 */
export default function parse(input) {
    const gen = matchNexter(input.toString().replace(STRIP_PATTERN, ''));

    const next = gen.next();
    let segment = next.value;
    let firstVar = true;
    let depthDefaultParams = 0;
    let depthParenthesis = 0;

    const vars = [];
    if (segment?.[1].length) {
        vars.push(segment[1]);
    }
    for (segment of gen) {
        const [delimiter, text] = segment;
        if (delimiter === '=') {
            if (text[0] === '>' && depthDefaultParams === 0) {
                break;
            } else {
                depthDefaultParams++;
            }
        } else if (delimiter === '(' && !firstVar && vars.length) {
            firstVar = true;
            depthParenthesis++;
        } else if (delimiter === '(' && firstVar) {
            vars.pop();
            if (text.length) {
                vars.push(text);
            }
            firstVar = false;
        } else if (delimiter === ')' && depthParenthesis > 0) {
            depthParenthesis--;
        } else if (delimiter === ')' && depthParenthesis === 0) {
            break;
        } else if (delimiter === ',' || (delimiter === '(' && vars.length === 0)) {
            if (depthParenthesis === 0) {
                depthDefaultParams = 0;
                vars.push(text);
            }
        }
    }
    return vars;
}
