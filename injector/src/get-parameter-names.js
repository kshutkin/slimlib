/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const STRIP_PATTERN = /(static.*$)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|^\s*async(?:\s*|\()(?!\s*=)|\s/gm;

const nonVarChars = ['=', '(', ')', ','];

/**
 * Generator function that yields substrings between non-variable characters
 * @param {string} string - The string to parse
 * @returns {Generator<string, void, undefined>}
 */
function* matchNexter(string) {
    const delimiters = new Set(nonVarChars);
    let buffer = '';
    let firstYield = true;

    for (let i = 0; i < string.length; i++) {
        const char = /** @type {string} */ (string[i]);
        if (delimiters.has(char)) {
            yield buffer;
            buffer = char;
            firstYield = false;
        } else {
            buffer += char;
        }
    }

    if (!firstYield && buffer) {
        yield buffer;
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
    let value = next.value;
    let firstVar = true;
    let depthDefaultParams = 0;
    let depthParenthesis = 0;

    const vars = [];
    if (value?.length) {
        vars.push(value);
    }
    for (value of gen) {
        const firstChar = value[0];
        if (firstChar === '=') {
            if (value[1] === '>' && depthDefaultParams === 0) {
                break;
            } else {
                depthDefaultParams++;
            }
        } else if (firstChar === '(' && !firstVar && vars.length) {
            firstVar = true;
            depthParenthesis++;
        } else if (firstChar === '(' && firstVar) {
            vars.pop();
            const newVar = value.slice(1);
            if (newVar.length) {
                vars.push(newVar);
            }
            firstVar = false;
        } else if (firstChar === ')' && depthParenthesis > 0) {
            depthParenthesis--;
        } else if (firstChar === ')' && depthParenthesis === 0) {
            break;
        } else if (firstChar === ',' || (firstChar === '(' && vars.length === 0)) {
            const newVar = value.slice(1);
            if (depthParenthesis === 0) {
                depthDefaultParams = 0;
                vars.push(newVar);
            }
        }
    }
    return vars;
}
