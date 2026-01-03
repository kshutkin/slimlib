/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const STRIP_PATTERN = /(static.*$)|(\/\/.*$)|(\/\*[\s\S]*?\*\/)|^\s*async(?:\s*|\()(?!\s*=)|\s/gm;

const nonVarChars = ['=', '(', ')', ','];

/**
 * @typedef {Object} MatchResult
 * @property {string} subString - The substring between non-variable characters
 * @property {number} start - Start index of the substring
 * @property {number} end - End index of the substring
 */

/**
 * Generator function that yields substrings between non-variable characters
 * @param {string} string - The string to parse
 * @returns {Generator<MatchResult, void, undefined>}
 */
function* matchNexter(string) {
    /**
     * Update the indexes of non-variable characters
     * @param {number} stringIndex - Current string index
     * @returns {number[]} Updated array of indexes
     */
    const updateIndex = stringIndex => {
        return indexes.map((foundAt, i) => {
            if (foundAt === stringIndex) {
                return string.indexOf(/** @type {string} */ (nonVarChars[i]), foundAt + 1);
            }
            return foundAt;
        });
    };

    /**
     * Find the minimum index from the indexes array
     * @returns {number} Minimum index or Infinity if none found
     */
    const minIndex = () => {
        return Math.min.apply(
            Math,
            indexes.filter(i => i > -1)
        );
    };

    let indexes = nonVarChars.map(c => string.indexOf(c));
    let index = 0;

    while (index !== Infinity) {
        const nextIndex = minIndex();
        if (nextIndex !== Infinity) {
            const subString = string.slice(index, nextIndex);
            const ret = {
                subString,
                start: index,
                end: nextIndex,
            };
            yield ret;
        } else if (string.length) {
            const subString = string.slice(index);
            const ret = {
                subString,
                start: index,
                end: string.length,
            };
            yield ret;
        }
        index = nextIndex;
        indexes = updateIndex(index);
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
    if (value?.subString?.length) {
        vars.push(value.subString);
    }
    for (value of gen) {
        const firstChar = value.subString[0];
        if (firstChar === '=') {
            if (value.subString[1] === '>' && depthDefaultParams === 0) {
                break;
            } else {
                depthDefaultParams++;
            }
        } else if (firstChar === '(' && !firstVar && vars.length) {
            firstVar = true;
            depthParenthesis++;
        } else if (firstChar === '(' && firstVar) {
            vars.pop();
            const newVar = value.subString.slice(1);
            if (newVar.length) {
                vars.push(newVar);
            }
            firstVar = false;
        } else if (firstChar === ')' && depthParenthesis > 0) {
            depthParenthesis--;
        } else if (firstChar === ')' && depthParenthesis === 0) {
            break;
        } else if (firstChar === ',' || (firstChar === '(' && vars.length === 0)) {
            const newVar = value.subString.slice(1);
            if (depthParenthesis === 0) {
                depthDefaultParams = 0;
                vars.push(newVar);
            }
        }
    }
    return vars;
}
