/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const STRIP_PATTERN = /(static.*$)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|^\s*async(?:\s*|\()(?!\s*=)|\s/gm;

const nonVarChars = ['=', '(', ')', ','];

/**
 * Generator function that yields substrings between non-variable characters
 * @param {string} string - The string to parse
 * @returns {Generator<string, void, undefined>}
 */
function* matchNexter(string) {
    let indexes = nonVarChars.map(c => string.indexOf(c));
    let index = 0;

    while (index !== Infinity) {
        const nextIndex = Math.min.apply(
            Math,
            indexes.filter(i => i > -1)
        );
        if (nextIndex !== Infinity) {
            yield string.slice(index, nextIndex);
        } else if (string.length) {
            yield string.slice(index);
        }
        index = nextIndex;
        indexes = indexes.map((foundAt, i) => {
            if (foundAt === index) {
                return string.indexOf(/** @type {string} */ (nonVarChars[i]), foundAt + 1);
            }
            return foundAt;
        });
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
