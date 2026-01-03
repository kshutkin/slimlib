/* based on https://github.com/CaptEmulation/get-parameter-names (MIT) */

const COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
const SPACES = /\s/gm;
const NEW_LINES = /\r?\n|\r/gm;
const ASYNC = /^\s*async(\s*|\()(?!\s*=)/;
const ES6_STATIC = /static.*$/gm;

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
    function updateIndex(stringIndex) {
        return indexes.map((foundAt, i) => {
            if (foundAt === stringIndex) {
                return string.indexOf(nonVarChars[i], foundAt + 1);
            }
            return foundAt;
        });
    }

    /**
     * Find the minimum index from the indexes array
     * @returns {number} Minimum index or Infinity if none found
     */
    function minIndex() {
        return Math.min.apply(
            Math,
            indexes.filter(i => i > -1)
        );
    }

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
    const gen = matchNexter(
        input.toString().replace(ES6_STATIC, '').replace(NEW_LINES, '').replace(COMMENTS, '').replace(ASYNC, '').replace(SPACES, '')
    );

    let next = gen.next();
    let value = next.value;
    let argsEnded = false;
    let firstVar = true;
    const depth = {
        defaultParams: 0,
        parenthesis: 0,
    };

    const vars = [];
    if (value?.subString?.length) {
        vars.push(value.subString);
    }
    next = gen.next();
    value = next.value;
    while (value !== undefined && !argsEnded) {
        const firstChar = value.subString[0];
        if (firstChar === '=') {
            if (value.subString[1] === '>' && depth.defaultParams === 0) {
                argsEnded = true;
            } else {
                depth.defaultParams++;
            }
        } else if (firstChar === '(' && !firstVar && vars.length) {
            firstVar = true;
            depth.parenthesis++;
        } else if (firstChar === '(' && firstVar) {
            vars.pop();
            const newVar = value.subString.slice(1);
            if (newVar.length) {
                vars.push(newVar);
            }
            firstVar = false;
        } else if (firstChar === ')' && depth.parenthesis > 0) {
            depth.parenthesis--;
        } else if (firstChar === ')' && depth.parenthesis === 0) {
            argsEnded = true;
        } else if (firstChar === ',' || (firstChar === '(' && vars.length === 0)) {
            const newVar = value.subString.slice(1);
            if (depth.parenthesis === 0) {
                depth.defaultParams = 0;
                vars.push(newVar);
            }
        }
        next = gen.next();
        value = next.value;
    }
    return vars;
}
